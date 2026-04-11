/**
 * Jira Cloud REST API client.
 *
 * Env vars:
 *   JIRA_BASE_URL   — e.g. https://yourcompany.atlassian.net
 *   JIRA_EMAIL       — your Atlassian account email
 *   JIRA_API_TOKEN   — API token from https://id.atlassian.com/manage-profile/security/api-tokens
 *   JIRA_PROJECT_KEY — default project key (e.g. "AC")
 */

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  statuses?: {
    planning?: string;
    implementing?: string;
    review?: string;
    done?: string;
  };
}

export interface JiraIssue {
  key: string;
  id: string;
  url: string;
}

export function loadJiraConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;

  if (!baseUrl || !email || !apiToken || !projectKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    email,
    apiToken,
    projectKey,
    statuses: {
      planning: process.env.JIRA_STATUS_PLANNING ?? "In Progress",
      implementing: process.env.JIRA_STATUS_IMPLEMENTING ?? "In Progress",
      review: process.env.JIRA_STATUS_REVIEW ?? "In Review",
      done: process.env.JIRA_STATUS_DONE ?? "Done",
    },
  };
}

function authHeader(config: JiraConfig): string {
  return "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
}

async function jiraFetch(
  config: JiraConfig,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<any> {
  const url = `${config.baseUrl}/rest/api/3${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${opts.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return {};
}

/**
 * Create a Jira issue (Task type by default).
 */
export async function jiraCreateIssue(
  config: JiraConfig,
  title: string,
  description: string,
  issueType: string = "Task",
): Promise<JiraIssue> {
  const body = {
    fields: {
      project: { key: config.projectKey },
      summary: title,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: description }],
          },
        ],
      },
      issuetype: { name: issueType },
    },
  };

  const data = await jiraFetch(config, "/issue", { method: "POST", body });
  return {
    key: data.key,
    id: data.id,
    url: `${config.baseUrl}/browse/${data.key}`,
  };
}

/**
 * Create a sub-task under a parent issue.
 */
export async function jiraCreateSubtask(
  config: JiraConfig,
  parentKey: string,
  title: string,
  description: string,
): Promise<JiraIssue> {
  const body = {
    fields: {
      project: { key: config.projectKey },
      parent: { key: parentKey },
      summary: title,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: description }],
          },
        ],
      },
      issuetype: { name: "Sub-task" },
    },
  };

  const data = await jiraFetch(config, "/issue", { method: "POST", body });
  return {
    key: data.key,
    id: data.id,
    url: `${config.baseUrl}/browse/${data.key}`,
  };
}

/**
 * Get issue details.
 */
export async function jiraGetIssue(
  config: JiraConfig,
  issueKey: string,
): Promise<JiraIssue & { status: string; summary: string }> {
  const data = await jiraFetch(config, `/issue/${issueKey}`);
  return {
    key: data.key,
    id: data.id,
    url: `${config.baseUrl}/browse/${data.key}`,
    status: data.fields?.status?.name ?? "unknown",
    summary: data.fields?.summary ?? "",
  };
}

/**
 * Transition an issue to a new status.
 */
export async function jiraTransitionIssue(
  config: JiraConfig,
  issueKey: string,
  targetStatus: string,
): Promise<void> {
  // First, get available transitions
  const data = await jiraFetch(config, `/issue/${issueKey}/transitions`);
  const transitions = data.transitions as Array<{ id: string; name: string }>;

  const match = transitions.find(
    (t) => t.name.toLowerCase() === targetStatus.toLowerCase(),
  );
  if (!match) {
    const available = transitions.map((t) => t.name).join(", ");
    throw new Error(
      `No transition to "${targetStatus}" available. Options: ${available}`,
    );
  }

  await jiraFetch(config, `/issue/${issueKey}/transitions`, {
    method: "POST",
    body: { transition: { id: match.id } },
  });
}

/**
 * Add a comment to an issue.
 */
export async function jiraAddComment(
  config: JiraConfig,
  issueKey: string,
  comment: string,
): Promise<void> {
  await jiraFetch(config, `/issue/${issueKey}/comment`, {
    method: "POST",
    body: {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: comment }],
          },
        ],
      },
    },
  });
}
