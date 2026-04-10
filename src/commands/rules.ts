import {
  createRule,
  getRule,
  listRules,
  updateRule,
  deleteRule,
  RuleType,
} from "../db/rules.js";

export interface RulesAddOptions {
  type: string;
  rule: string;
  scope: string;
  severity?: string;
  confidence?: string;
  checkPattern?: string;
  prevention?: string;
}

export async function rulesAddCommand(opts: RulesAddOptions): Promise<void> {
  const validTypes: RuleType[] = ["hard_rule", "soft_rule", "anti_pattern"];
  if (!validTypes.includes(opts.type as RuleType)) {
    console.error(`Invalid type "${opts.type}". Must be: ${validTypes.join(", ")}`);
    process.exit(1);
  }

  const rule = createRule({
    type: opts.type as RuleType,
    rule: opts.rule,
    scope: opts.scope,
    severity: opts.severity,
    confidence: opts.confidence ? parseFloat(opts.confidence) : undefined,
    check_pattern: opts.checkPattern,
    prevention: opts.prevention,
    source: "manual",
  });

  console.log(`✓ Created ${rule.type}: ${rule.id}`);
  console.log(`  "${rule.rule}"`);
  console.log(`  scope: ${rule.scope}`);
}

export async function rulesListCommand(opts: {
  type?: string;
  scope?: string;
  active?: boolean;
}): Promise<void> {
  const rules = listRules({
    type: opts.type as RuleType | undefined,
    scope: opts.scope,
    active: opts.active,
  });

  if (rules.length === 0) {
    console.log("No rules defined.");
    console.log('Add one: auto-coder rules add --type hard_rule --rule "..." --scope all');
    return;
  }

  const idW = 14;
  const typeW = 14;
  const scopeW = 16;

  console.log(`${rules.length} rule(s):\n`);
  console.log(`${"ID".padEnd(idW)}${"TYPE".padEnd(typeW)}${"SCOPE".padEnd(scopeW)}${"ACTIVE".padEnd(8)}RULE`);
  console.log("─".repeat(idW + typeW + scopeW + 8 + 40));
  for (const r of rules) {
    const ruleText = r.rule.length > 50 ? r.rule.slice(0, 47) + "..." : r.rule;
    const active = r.active ? "yes" : "no";
    console.log(
      `${r.id.padEnd(idW)}${r.type.padEnd(typeW)}${r.scope.padEnd(scopeW)}${active.padEnd(8)}${ruleText}`,
    );
  }
}

export async function rulesGetCommand(id: string): Promise<void> {
  const rule = getRule(id);
  if (!rule) { console.error(`No rule with id "${id}"`); process.exit(1); }

  console.log(`# Rule ${rule.id}`);
  console.log();
  console.log(`Type:         ${rule.type}`);
  console.log(`Rule:         ${rule.rule}`);
  console.log(`Scope:        ${rule.scope}`);
  console.log(`Active:       ${rule.active}`);
  if (rule.severity) console.log(`Severity:     ${rule.severity}`);
  if (rule.confidence !== null) console.log(`Confidence:   ${rule.confidence}`);
  if (rule.source) console.log(`Source:       ${rule.source}`);
  if (rule.source_detail) console.log(`Detail:       ${rule.source_detail}`);
  if (rule.check_pattern) console.log(`Pattern:      ${rule.check_pattern}`);
  if (rule.prevention) console.log(`Prevention:   ${rule.prevention}`);
  console.log(`Applied:      ${rule.times_applied} times`);
  console.log(`Violated:     ${rule.times_violated} times`);
  console.log(`Created:      ${rule.created_at}`);
}

export async function rulesDisableCommand(id: string): Promise<void> {
  const rule = getRule(id);
  if (!rule) { console.error(`No rule with id "${id}"`); process.exit(1); }
  updateRule(id, { active: false });
  console.log(`✓ Disabled rule ${id}`);
}

export async function rulesEnableCommand(id: string): Promise<void> {
  const rule = getRule(id);
  if (!rule) { console.error(`No rule with id "${id}"`); process.exit(1); }
  updateRule(id, { active: true });
  console.log(`✓ Enabled rule ${id}`);
}

export async function rulesDeleteCommand(id: string): Promise<void> {
  const rule = getRule(id);
  if (!rule) { console.error(`No rule with id "${id}"`); process.exit(1); }
  deleteRule(id);
  console.log(`✓ Deleted rule ${id}`);
}
