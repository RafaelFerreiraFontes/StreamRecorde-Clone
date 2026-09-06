export function normalizeTextInput(value: string): string {
   if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
