import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DirectoryListing {
  path: string;
  truncated?: boolean;
  entries: { name: string; path: string; kind: "directory" | "file" }[];
}
export interface RecordingLocation {
  status: "available" | "file_not_found" | "directory_unavailable";
  directory?: DirectoryListing;
  file?: string;
}

/** Single read-only boundary for the recordings tree. No file contents are read. */
@Injectable()
export class RecordingsFilesystemService {
  private readonly root = path.resolve(
    process.env.RECORDINGS_ROOT?.trim() || "../recordings",
  );

  relativePath(value: unknown): string {
    if (
      typeof value !== "string" ||
      value.length > 1024 ||
      /[\\:%\x00-\x1f\x7f]/.test(value) ||
      path.posix.isAbsolute(value) ||
      path.win32.isAbsolute(value)
    ) {
      throw new BadRequestException("Invalid relative recording path");
    }
    const parts = value === "" ? [] : value.split("/");
    if (
      parts.some((part) => !part || part.startsWith(".") || /[. ]$/.test(part))
    ) {
      throw new BadRequestException("Invalid relative recording path");
    }
    return parts.join("/");
  }

  private inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(".." + path.sep) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  }

  private async resolve(relative: string): Promise<string> {
    const root = await fs.realpath(this.root);
    let candidate = root;
    for (const part of relative ? relative.split("/") : []) {
      candidate = path.join(candidate, part);
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink())
        throw new Error("Symbolic links are unavailable");
      const canonical = await fs.realpath(candidate);
      if (!this.inside(root, canonical))
        throw new Error("Outside recordings root");
      candidate = canonical;
    }
    return candidate;
  }

  async list(input: unknown = ""): Promise<DirectoryListing> {
    const relative = this.relativePath(input); // Validate before filesystem access.
    try {
      const directory = await this.resolve(relative);
      const entries: DirectoryListing["entries"] = [];
      const handle = await fs.opendir(directory);
      let truncated = false;
      // Bound metadata responses; never enumerate recursively.
      for await (const entry of handle) {
        if (entries.length >= 1000) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
          continue;
        const child = relative ? relative + "/" + entry.name : entry.name;
        try {
          this.relativePath(child);
        } catch {
          continue;
        }
        entries.push({
          name: entry.name,
          path: child,
          kind: entry.isDirectory() ? "directory" : "file",
        });
      }
      entries.sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
      );
      return {
        path: relative,
        entries,
        ...(truncated ? { truncated: true } : {}),
      };
    } catch {
      throw new NotFoundException("Recording directory unavailable");
    }
  }

  async location(outputFile?: string): Promise<RecordingLocation> {
    if (!outputFile) return { status: "directory_unavailable" };
    let relative: string;
    try {
      // Stored absolute paths are trusted metadata only after root containment validation.
      // Reject traversal before normalization, even in persisted metadata.
      if (
        outputFile.split(/[\\/]/).some((part) => part === ".." || part === ".")
      ) {
        return { status: "directory_unavailable" };
      }
      if (path.isAbsolute(outputFile)) {
        if (!this.inside(this.root, outputFile))
          return { status: "directory_unavailable" };
        relative = this.relativePath(
          path.relative(this.root, outputFile).split(path.sep).join("/"),
        );
      } else {
        relative = this.relativePath(outputFile);
      }
      if (!relative) return { status: "directory_unavailable" };
      const parent = path.posix.dirname(relative);
      const directory = await this.list(parent === "." ? "" : parent);
      let available = false;
      try {
        available = (await fs.stat(await this.resolve(relative))).isFile();
      } catch {
        /* Missing or unsafe file. */
      }
      return {
        status: available ? "available" : "file_not_found",
        directory,
        file: path.posix.basename(relative),
      };
    } catch {
      return { status: "directory_unavailable" };
    }
  }
}
