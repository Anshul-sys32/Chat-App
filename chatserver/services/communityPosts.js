const MESSAGE_TYPES = new Set(["message", "question", "poll", "event"]);

const parseStructuredData = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const validateCommunityPost = (payload, isCommunity) => {
  const messageType = payload.messageType || "message";
  if (!MESSAGE_TYPES.has(messageType)) return { error: "Choose a supported community post type." };
  if (!isCommunity && messageType !== "message") return { error: "Structured posts are only available in communities." };
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (content.length > 10000) return { error: "Messages must be 10,000 characters or shorter." };
  if (messageType === "message") return { messageType, content, structuredData: null };
  if (messageType === "question") {
    return content ? { messageType, content, structuredData: null } : { error: "Write a question before posting." };
  }

  const data = payload.structuredData;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "Complete the post details." };
  if (messageType === "poll") {
    const question = typeof data.question === "string" ? data.question.trim() : "";
    const options = Array.isArray(data.options) ? data.options.map((option) => typeof option === "string" ? option.trim() : "") : [];
    const normalizedOptions = [...new Set(options)];
    const endsAt = data.endsAt || null;
    if (!question || question.length > 300 || options.length < 2 || options.length > 8
      || normalizedOptions.length !== options.length || options.some((option) => !option || option.length > 100)) {
      return { error: "Polls need a question and 2 to 8 distinct options." };
    }
    if (endsAt && (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.now())) {
      return { error: "Poll closing time must be in the future." };
    }
    return {
      messageType,
      content: question,
      structuredData: { question, options, multipleChoice: data.multipleChoice === true, endsAt },
    };
  }

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const location = typeof data.location === "string" ? data.location.trim() : "";
  const startsAt = data.startsAt;
  if (!title || title.length > 120 || description.length > 3000 || location.length > 200
    || !startsAt || !Number.isFinite(Date.parse(startsAt))) {
    return { error: "Events need a title and valid start date." };
  }
  return {
    messageType,
    content: title,
    structuredData: { title, description, location, startsAt: new Date(startsAt).toISOString() },
  };
};

const loadCommunityEngagement = async (messages, userId, execute) => {
  const polls = messages.filter((message) => message.messageType === "poll");
  const events = messages.filter((message) => message.messageType === "event");
  const pollData = new Map();
  const eventData = new Map();
  if (polls.length) {
    const ids = polls.map((message) => message._id);
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await execute(
      `SELECT message_id AS messageId, option_index AS optionIndex, COUNT(*) AS voteCount,
              SUM(user_id = ?) AS ownVotes
       FROM community_poll_votes WHERE message_id IN (${placeholders})
       GROUP BY message_id, option_index`,
      [userId, ...ids]
    );
    for (const row of rows) {
      const current = pollData.get(String(row.messageId)) || { counts: [], selected: [] };
      current.counts[Number(row.optionIndex)] = Number(row.voteCount);
      if (Number(row.ownVotes)) current.selected.push(Number(row.optionIndex));
      pollData.set(String(row.messageId), current);
    }
  }
  if (events.length) {
    const ids = events.map((message) => message._id);
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await execute(
      `SELECT message_id AS messageId, response, COUNT(*) AS responseCount,
              MAX(CASE WHEN user_id = ? THEN response ELSE NULL END) AS ownResponse
       FROM community_event_rsvps WHERE message_id IN (${placeholders})
       GROUP BY message_id, response`,
      [userId, ...ids]
    );
    for (const row of rows) {
      const current = eventData.get(String(row.messageId)) || { going: 0, maybe: 0, notGoing: 0, myResponse: null };
      const key = row.response === "not_going" ? "notGoing" : row.response;
      current[key] = Number(row.responseCount);
      if (row.ownResponse) current.myResponse = row.ownResponse;
      eventData.set(String(row.messageId), current);
    }
  }
  return messages.map((message) => {
    const structuredData = parseStructuredData(message.structuredData);
    if (message.messageType === "poll") {
      const results = pollData.get(String(message._id)) || { counts: [], selected: [] };
      results.counts = (structuredData?.options || []).map((_, index) => results.counts[index] || 0);
      return { ...message, structuredData, pollResults: results };
    }
    if (message.messageType === "event") {
      return {
        ...message,
        structuredData,
        eventResults: eventData.get(String(message._id)) || { going: 0, maybe: 0, notGoing: 0, myResponse: null },
      };
    }
    return { ...message, structuredData };
  });
};

module.exports = { loadCommunityEngagement, parseStructuredData, validateCommunityPost };