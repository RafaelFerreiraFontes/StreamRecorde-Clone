import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000).then((value) => {
    console.log(`Server is running on port ${value?.address()?.port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
