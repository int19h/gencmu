// A client of gencmu, type-checked against the declarations in types/ and
// never run. Each @ts-expect-error line is a misuse the types must reject.
import { loaderFromSources, resultJson, toBrackets, type ParseResult, type ResultNode, type Verdict } from "gencmu";
import { loaderFromDirectory } from "gencmu/node";

const loader = loaderFromDirectory();
const dialect = loader.dialect("dialects/notation.md");
const result: ParseResult = dialect.parse("text ≔ A ;", { features: ["sa-su"], until: "syntax" });

const verdicts: (Verdict | null)[] = result.stages.map((stage) => stage.verdict);
for (const stage of result.stages) {
  if (stage.verdict === "tie") {
    // A tie has its tied tree and witness without a check.
    rules(stage.tied);
    void stage.witness[0];
  } else {
    // @ts-expect-error only a tie has a tied tree
    rules(stage.tied);
  }
}
const brackets: string = toBrackets(result, { showElided: true });
const json = resultJson(result);
const format: number = json.format;

function rules(node: ResultNode): string[] {
  switch (node.kind) {
    case "rule":
      return [node.rule, ...node.children.flatMap(rules)];
    case "token":
      return [node.terminal];
    case "elided":
      return [];
  }
}
if (result.tree) rules(result.tree);
if (result.error) {
  const kind: "rejected" | "ambiguous" | "grammar" = result.error.kind;
  void kind;
}

const inMemory = loaderFromSources({ "unicode.txt": "" });
void inMemory;

// @ts-expect-error a text is a string
dialect.parse(42);
// @ts-expect-error features are names
dialect.parse("", { features: [1] });
// @ts-expect-error a token node has no children
if (result.tree && result.tree.kind === "token") void result.tree.children;
// @ts-expect-error resources map paths to text
loaderFromSources({ "unicode.txt": 1 });

void verdicts, brackets, format;
