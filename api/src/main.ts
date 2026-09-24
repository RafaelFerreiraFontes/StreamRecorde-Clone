import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import {
  resolveAllConfigPaths,
  initializeRuntimeFiles,
  sweepStaleTempFiles,
  probeAtomicReplace,
} from "./streams/json-compatibility.adapters";

async function bootstrap() {
  // Resolve all four config paths using the established precedence
  const configPaths = resolveAllConfigPaths(process.env);

  // Initialize all config files with canonical shapes
  try {
    await initializeRuntimeFiles(configPaths);
    console.log(`Config directory initialized: ${configPaths.watchlist.replace(/\/[^/]+$/, "")}`);
    console.log(`  watchlist: ${configPaths.watchlist}`);
    console.log(`  channels_status: ${configPaths.channels_status}`);
    console.log(`  sessions: ${configPaths.sessions}`);
    console.log(`  streams: ${configPaths.streams}`);
  } catch (error) {
    console.error(`Failed to initialize config directory: ${error}`);
    process.exit(1);
  }

  // ─── Stale temp sweep ─────────────────────────────────────────────────────
  const configuredPaths = Object.values(configPaths);
  const configDirectories = new Set(
    configuredPaths.map((filePath) => filePath.replace(/\/[^/]+$/, "")),
  );
  await Promise.all([...configDirectories].map(sweepStaleTempFiles));

  // ─── Atomic-replace capability probe ───────────────────────────────────────
  try {
    await Promise.all(configuredPaths.map((filePath) => probeAtomicReplace(filePath)));
  } catch (error) {
    console.error(`Atomic-replace capability probe FAILED | operation=create+write+fsync+replace+read+cleanup | uid=${process.getuid?.() ?? "N/A"} | gid=${process.getgid?.() ?? "N/A"}`);
    console.error(`Probe error: ${error}`);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000).then((value) => {
    console.log(`Server is running on port ${value?.address()?.port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
