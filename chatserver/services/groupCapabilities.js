const GROUP_CAPABILITIES = Object.freeze({
  standard: Object.freeze({ channels: false, structuredPosts: false }),
  community: Object.freeze({ channels: true, structuredPosts: false }),
});

const isGroupType = (type) => Object.hasOwn(GROUP_CAPABILITIES, type);
const getGroupCapabilities = (type) => GROUP_CAPABILITIES[type] || GROUP_CAPABILITIES.standard;

module.exports = { GROUP_CAPABILITIES, getGroupCapabilities, isGroupType };
