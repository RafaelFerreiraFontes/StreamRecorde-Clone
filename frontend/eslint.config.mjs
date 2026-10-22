import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const config = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"] },
  prettier,
];

export default config;
