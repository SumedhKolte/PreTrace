import type { CompanyTech, TechCategory } from "@preptrace/shared";

/**
 * Company DNA — deterministic technology detection.
 *
 * A curated dictionary is matched against the text of the company's own crawled pages.
 * No model is involved, so a technology is only ever listed if the company actually
 * wrote about it (e.g. "Vitess" appears for a company only if its pages say "Vitess").
 * Ambiguous names (Go, Rust, Swift, Spark, Rails…) use case-sensitive, context-aware
 * patterns to avoid matching ordinary English words.
 */

interface TechDef {
  name: string;
  category: TechCategory;
  re: RegExp;
}

const t = (name: string, category: TechCategory, re: RegExp): TechDef => ({ name, category, re });
const word = (s: string) => new RegExp(`(?<![\\w.])${s.replace(/[.+#]/g, (c) => `\\${c}`)}(?![\\w])`, "i");

export const TECH_DICTIONARY: TechDef[] = [
  // Languages
  t("TypeScript", "language", word("TypeScript")),
  t("JavaScript", "language", word("JavaScript")),
  t("Python", "language", word("Python")),
  t("Java", "language", /(?<![\w.])Java(?![\w]|Script)/),
  t("Kotlin", "language", word("Kotlin")),
  t("Scala", "language", /(?<![\w.])Scala(?![\w])/),
  t("Go", "language", /\bGolang\b|(?<![\w.])Go(?= (?:services?|code|microservices|backend|and|or|,)|,)|\bin Go\b|\bwritten in Go\b/),
  t("Rust", "language", /(?<![\w.])Rust(?![\w])/),
  t("Ruby", "language", /(?<![\w.])Ruby(?![\w])/),
  t("PHP", "language", /(?<![\w.])PHP(?![\w])/),
  t("C#", "language", /(?<![\w.])C#/),
  t("C++", "language", /(?<![\w.])C\+\+/),
  t("Elixir", "language", word("Elixir")),
  t("Swift", "language", /(?<![\w.])Swift(?![\w])(?=.{0,40}\b(?:iOS|app|code|UI))|\bSwiftUI\b/),
  t("SQL", "language", /(?<![\w.])SQL(?![\w])/),
  // Frameworks / runtimes
  t("Node.js", "framework", /\bNode(?:\.js|JS)\b/i),
  t("React", "framework", /(?<![\w.])React(?![\w])(?! Native)/),
  t("React Native", "framework", /\bReact Native\b/i),
  t("Next.js", "framework", /\bNext\.js\b/i),
  t("Vue", "framework", /\bVue(?:\.js)?\b/),
  t("Angular", "framework", /(?<![\w.])Angular(?![\w])/),
  t("Ruby on Rails", "framework", /\bRuby on Rails\b|(?<![\w.])Rails (?:app|apps|monolith|codebase|application)\b/),
  t("Django", "framework", word("Django")),
  t("FastAPI", "framework", word("FastAPI")),
  t("Flask", "framework", /(?<![\w.])Flask(?![\w])/),
  t("Spring Boot", "framework", /\bSpring Boot\b/i),
  t("GraphQL", "framework", word("GraphQL")),
  t("gRPC", "framework", word("gRPC")),
  t(".NET", "framework", /(?<![\w])\.NET\b/),
  // Datastores
  t("PostgreSQL", "datastore", /\bPostgre(?:SQL|s)\b/i),
  t("MySQL", "datastore", word("MySQL")),
  t("Vitess", "datastore", word("Vitess")),
  t("MongoDB", "datastore", word("MongoDB")),
  t("Redis", "datastore", word("Redis")),
  t("Cassandra", "datastore", word("Cassandra")),
  t("DynamoDB", "datastore", word("DynamoDB")),
  t("Elasticsearch", "datastore", /\bElastic ?search\b/i),
  t("Snowflake", "datastore", /(?<![\w.])Snowflake(?![\w])/),
  t("BigQuery", "datastore", word("BigQuery")),
  t("ClickHouse", "datastore", word("ClickHouse")),
  t("Spanner", "datastore", /\bCloud Spanner\b|(?<![\w.])Spanner(?![\w])/),
  t("CockroachDB", "datastore", word("CockroachDB")),
  t("SQLite", "datastore", word("SQLite")),
  // Messaging / data processing
  t("Kafka", "messaging", /\bKafka\b/i),
  t("RabbitMQ", "messaging", word("RabbitMQ")),
  t("Pub/Sub", "messaging", /\bPub\/Sub\b/i),
  t("Amazon SQS", "messaging", /\bSQS\b/),
  t("Apache Spark", "messaging", /\bApache Spark\b|\bPySpark\b|\bSpark (?:Streaming|SQL|jobs?)\b/),
  t("Apache Flink", "messaging", /\bFlink\b/),
  t("Airflow", "messaging", /\bAirflow\b/),
  t("dbt", "messaging", /(?<![\w.])dbt(?![\w])/),
  // Infrastructure / cloud
  t("Kubernetes", "infrastructure", /\bKubernetes\b|\bK8s\b/i),
  t("Docker", "infrastructure", /(?<![\w.])Docker(?![\w])/),
  t("Terraform", "infrastructure", word("Terraform")),
  t("AWS", "infrastructure", /\bAWS\b|\bAmazon Web Services\b/),
  t("Google Cloud", "infrastructure", /\bGoogle Cloud\b|\bGCP\b/),
  t("Azure", "infrastructure", /(?<![\w.])Azure(?![\w])/),
  t("Istio", "infrastructure", word("Istio")),
  t("Envoy", "infrastructure", /(?<![\w.])Envoy(?![\w])/),
  t("Datadog", "infrastructure", word("Datadog")),
  t("Prometheus", "infrastructure", /(?<![\w.])Prometheus(?![\w])/),
  t("Grafana", "infrastructure", word("Grafana")),
  t("OpenTelemetry", "infrastructure", word("OpenTelemetry")),
  t("Serverless / Lambda", "infrastructure", /\bAWS Lambda\b|\bserverless\b/i),
  // Practices
  t("Microservices", "practice", /\bmicro-?services\b/i),
  t("Event-driven architecture", "practice", /\bevent[- ]driven\b|\bevent sourcing\b/i),
  t("Feature flags", "practice", /\bfeature flags?\b/i),
  t("Trunk-based development", "practice", /\btrunk[- ]based\b/i),
  t("Continuous deployment", "practice", /\bcontinuous (?:deployment|delivery)\b|\bCI\/CD\b/i),
  t("Double-entry ledger", "practice", /\bdouble[- ]entry\b/i),
  t("Idempotency", "practice", /\bidempoten(?:t|cy)\b/i),
];

function countMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return (text.match(g) ?? []).length;
}

/** Detect technologies mentioned on the company's own pages, most-mentioned first. */
export function detectTechStack(pages: { url: string; text: string }[]): CompanyTech[] {
  const found = new Map<string, CompanyTech>();
  for (const page of pages) {
    for (const def of TECH_DICTIONARY) {
      const n = countMatches(def.re, page.text);
      if (n === 0) continue;
      const cur = found.get(def.name) ?? { name: def.name, category: def.category, mentions: 0, sources: [], inJd: false };
      cur.mentions += n;
      if (!cur.sources.includes(page.url)) cur.sources.push(page.url);
      found.set(def.name, cur);
    }
  }
  return [...found.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)).slice(0, 24);
}

/**
 * Per-kit overlap with the job description. Kept separate from detection because
 * research is cached and shared across users, while the JD is private to one kit.
 */
export function markJdOverlap(techs: CompanyTech[], jd: string): CompanyTech[] {
  return techs
    .map((tech) => {
      const def = TECH_DICTIONARY.find((d) => d.name === tech.name);
      return { ...tech, inJd: def ? countMatches(def.re, jd) > 0 : false };
    })
    .sort((a, b) => Number(b.inJd) - Number(a.inJd) || b.mentions - a.mentions || a.name.localeCompare(b.name));
}
