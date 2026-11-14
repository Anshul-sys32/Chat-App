const DEFAULT_COMMUNITY_CHANNELS = [
  { name: "general", description: "General discussion", postingMode: "members" },
  { name: "announcements", description: "Updates from community leaders", postingMode: "admins" },
  { name: "development", description: "Technical work and project updates", postingMode: "members" },
  { name: "help", description: "Questions and troubleshooting", postingMode: "members" },
];

const ensureDefaultCommunityChannels = async (executor, groupId, creatorId) => {
  for (const [sortOrder, channel] of DEFAULT_COMMUNITY_CHANNELS.entries()) {
    await executor.execute(
      `INSERT IGNORE INTO group_channels
       (group_id, name, slug, description, posting_mode, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [groupId, channel.name, channel.name, channel.description, channel.postingMode, sortOrder, creatorId]
    );
  }
};

module.exports = { DEFAULT_COMMUNITY_CHANNELS, ensureDefaultCommunityChannels };