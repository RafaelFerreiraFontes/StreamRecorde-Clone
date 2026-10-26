import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { InternalEventDto } from "./dto/internal-event.dto";
import { InternalEventsService } from "./internal-events.service";

@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const supplied = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
      .headers["x-internal-token"];
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected?.trim()) {
      throw new UnauthorizedException("Internal token is not configured on the API");
    }
    if (
      typeof supplied !== "string" ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      throw new UnauthorizedException("Invalid internal token");
    }
    return true;
  }
}

@Controller("internal/v1")
@UseGuards(InternalTokenGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class InternalStreamsController {
  constructor(private readonly service: InternalEventsService) {}

  @Get("watch-targets/execution-configs")
  getExecutionConfigs() {
    return this.service.getExecutionConfigs();
  }

  @Post("events")
  handleEvent(@Body() dto: InternalEventDto) {
    return this.service.handleEvent(dto);
  }
}
