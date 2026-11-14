const truncate = (value, limit = 500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);

const decodeXml = (value) => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => ({ "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" })[entity]);

const xmlText = (source, tag) => {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
  return match ? decodeXml(match[1]).replace(/<[^>]*>/g, " ").trim() : "";
};

const githubProvider = {
  key: "github",
  supportedEvents: ["push", "pull_request", "issues", "release"],
  normalize(eventName, payload) {
    const repository = payload.repository?.full_name || "GitHub";
    if (eventName === "push") {
      const commit = payload.commits?.[0];
      return commit ? { title: `New commit in ${repository}`, body: `${commit.id?.slice(0, 7)} ${truncate(commit.message, 240)}`, url: commit.url }
        : { title: `Push to ${repository}`, body: `${payload.commits?.length || 0} commits pushed to ${payload.ref || "a branch"}`, url: payload.compare };
    }
    if (eventName === "pull_request") {
      const request = payload.pull_request;
      if (!request) return null;
      return { title: `Pull request ${payload.action}: ${truncate(request.title, 180)}`, body: `${repository} by ${request.user?.login || "a contributor"}`, url: request.html_url };
    }
    if (eventName === "issues") {
      const issue = payload.issue;
      if (!issue) return null;
      return { title: `Issue ${payload.action}: ${truncate(issue.title, 180)}`, body: `${repository} by ${issue.user?.login || "a contributor"}`, url: issue.html_url };
    }
    if (eventName === "release") {
      const release = payload.release;
      if (!release) return null;
      return { title: `Release published: ${truncate(release.name || release.tag_name, 180)}`, body: `${repository} ${truncate(release.body, 240)}`, url: release.html_url };
    }
    return null;
  },
};

const genericWebhookProvider = {
  key: "webhook",
  normalize(eventName, payload) {
    const title = truncate(payload.title || eventName || "Webhook event", 180);
    const body = truncate(payload.message || payload.body || payload.text || "", 1000);
    const url = typeof payload.url === "string" && /^https?:\/\//i.test(payload.url) ? payload.url : null;
    return { title, body, url };
  },
};

const rssProvider = {
  key: "rss",
  parse(xml) {
    if (typeof xml !== "string" || xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
      throw new Error("RSS feed is invalid or too large.");
    }
    if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error("The XML document is not an RSS or Atom feed.");
    const blocks = xml.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)\s*>/gi) || [];
    return blocks.slice(0, 50).map((block) => {
      const atomLink = block.match(/<link\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*\/?\s*>/i);
      const url = decodeXml(atomLink?.[2] || xmlText(block, "link") || xmlText(block, "guid") || xmlText(block, "id"));
      const title = xmlText(block, "title");
      const eventKey = (xmlText(block, "guid") || xmlText(block, "id") || url || title).slice(0, 191);
      return {
        title: truncate(title, 180),
        body: truncate(xmlText(block, "description") || xmlText(block, "summary") || xmlText(block, "content"), 600),
        url: /^https?:\/\//i.test(url) ? url : null,
        eventKey,
      };
    }).filter((entry) => entry.eventKey && entry.title);
  },
};

const googleCalendarProvider = {
  key: "google_calendar",
  credentialsReady(config) {
    return Boolean(config?.calendarId && config?.accessToken);
  },
  eventMessage(event) {
    return {
      title: truncate(event.summary || "Calendar event", 180),
      body: `${event.start?.dateTime || event.start?.date || "Time not set"}${event.location ? ` · ${truncate(event.location, 160)}` : ""}`,
      url: event.htmlLink || null,
    };
  },
};

const providers = new Map([
  [githubProvider.key, githubProvider],
  [genericWebhookProvider.key, genericWebhookProvider],
  [rssProvider.key, rssProvider],
  [googleCalendarProvider.key, googleCalendarProvider],
]);

module.exports = { genericWebhookProvider, githubProvider, googleCalendarProvider, providers, rssProvider };