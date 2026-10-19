import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";
import { RelationalStreamsRepository } from "./relational-streams.repository";
import { ExecutionConfig, InternalEventDto } from "./dto/internal-event.dto";

@Injectable()
export class InternalEventsService {
  private readonly repository: RelationalStreamsRepository;

  constructor(database: DatabaseService) {
    this.repository = new RelationalStreamsRepository(database);
  }

  private requireRelational() {
    if (process.env.RELATIONAL_STORAGE !== "true") {
      throw new ServiceUnavailableException("Worker bridge requires relational storage");
    }
  }

  async getExecutionConfigs(): Promise<ExecutionConfig[]> {
    this.requireRelational();
    try {
      return await this.repository.getExecutionConfigs();
    } catch {
      throw new ServiceUnavailableException("Worker configuration unavailable");
    }
  }

  async handleEvent(dto: InternalEventDto) {
    this.requireRelational();
    const canonical = Object.fromEntries(Object.entries(dto)
      .filter(([, value]) => value !== undefined).sort(([left], [right]) => left.localeCompare(right)));
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    try {
      return await this.repository.handleWorkerEvent(dto, fingerprint);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Worker persistence unavailable");
    }
  }
}