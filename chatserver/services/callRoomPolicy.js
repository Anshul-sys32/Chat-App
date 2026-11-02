const MAX_CALL_PARTICIPANTS = 4;

const canInviteToCallRoom = (room, actorId, recipientId) => {
  if (!room || String(room.hostId) !== String(actorId)) return { allowed: false, reason: "not-host" };
  if (room.participants.has(String(recipientId))) return { allowed: true, reason: "already-joined" };
  if (room.participants.size >= MAX_CALL_PARTICIPANTS) return { allowed: false, reason: "full" };
  return { allowed: true, reason: null };
};

module.exports = { MAX_CALL_PARTICIPANTS, canInviteToCallRoom };
