import { startFixtureServer } from "./fixtureServer";

const port = Number(process.env.FIXTURES_PORT ?? 8099);
startFixtureServer(port).then(({ url }) => {
  console.log(`Fixture company sites served at ${url}/`);
  console.log(`  ${url}/acme/     — hiring process behind "Life at Acme", prompt-injection text, robots-blocked page`);
  console.log(`  ${url}/globex/   — no hiring-process page`);
  console.log(`  ${url}/initech/  — near-empty site`);
  console.log(`  ${url}/stress/   — huge page, slow page, PDF, redirect to metadata IP, 404`);
});
