import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaArchive, FaCamera, FaChevronDown, FaChevronUp, FaCrown, FaHashtag, FaPlus, FaUserMinus, FaUsers } from 'react-icons/fa';
import Socket from '../Socket';
import Avatar from './Avatar';

const apiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
});

export default function GroupList({ search = '', onSelectGroup }) {
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState('standard');
  const [channels, setChannels] = useState([]);
  const [newChannelName, setNewChannelName] = useState('');
  const [channelPostingMode, setChannelPostingMode] = useState('members');
  const [newMemberId, setNewMemberId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  let currentUser = null;
  try {
    currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    localStorage.removeItem('user');
  }

  useEffect(() => {
    let active = true;
    axios.get(`${apiUrl}/api/groups`, authConfig()).then(({ data }) => {
      if (active) setGroups(data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Could not load groups.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleRemoved = ({ groupId }) => {
      setGroups((previous) => previous.filter((group) => String(group._id) !== String(groupId)));
      setActiveGroup((previous) => previous && String(previous._id) === String(groupId) ? null : previous);
    };
    const handleRoleChange = ({ groupId, userId, role }) => {
      if (String(userId) === String(currentUser?._id)) {
        setGroups((previous) => previous.map((group) => String(group._id) === String(groupId) ? { ...group, role } : group));
        setActiveGroup((previous) => previous && String(previous._id) === String(groupId) ? { ...previous, role } : previous);
      }
      setMembers((previous) => previous.map((member) => String(member._id) === String(userId) ? { ...member, role } : member));
    };
    const handleMemberAdded = ({ groupId, member, groupName, members: memberCount }) => {
      setGroups((previous) => previous.map((group) => String(group._id) === String(groupId)
        ? { ...group, members: memberCount }
        : group));
      if (String(activeGroup?._id) === String(groupId)) {
        setMembers((previous) => previous.some((current) => String(current._id) === String(member._id))
          ? previous
          : [...previous, member]);
        setUsers((previous) => previous.filter((candidate) => String(candidate._id) !== String(member._id)));
      } else if (!groups.some((group) => String(group._id) === String(groupId))
        && String(member._id) === String(currentUser?._id)) {
        setGroups((previous) => [...previous, { _id: groupId, name: groupName, members: memberCount, role: 'member' }]);
      }
    };
    const handleMemberChanged = ({ groupId, userId }) => {
      setGroups((previous) => previous.map((group) => String(group._id) === String(groupId)
        ? { ...group, members: Math.max(0, Number(group.members) - 1) }
        : group));
      if (String(activeGroup?._id) === String(groupId)) {
        setMembers((previous) => previous.filter((member) => String(member._id) !== String(userId)));
      }
    };
    const handleGroupPicture = ({ groupId, avatarUrl }) => {
      setGroups((previous) => previous.map((group) => String(group._id) === String(groupId)
        ? { ...group, avatarUrl }
        : group));
      setActiveGroup((previous) => previous && String(previous._id) === String(groupId)
        ? { ...previous, avatarUrl }
        : previous);
    };
    const handleProfilePicture = ({ userId, profilePicture }) => {
      setMembers((previous) => previous.map((member) => String(member._id) === String(userId)
        ? { ...member, profilePicture }
        : member));
    };
    const handleChannelCreated = (channel) => {
      if (String(activeGroup?._id) !== String(channel.groupId)) return;
      setChannels((previous) => previous.some((item) => String(item._id) === String(channel._id))
        ? previous
        : [...previous, channel].sort((a, b) => a.sortOrder - b.sortOrder));
    };
    const handleChannelUpdated = (channel) => {
      setChannels((previous) => previous.map((item) => String(item._id) === String(channel._id) ? channel : item));
    };
    const handleChannelArchived = ({ channelId }) => {
      setChannels((previous) => previous.filter((item) => String(item._id) !== String(channelId)));
    };
    Socket.on('group-member-removed', handleRemoved);
    Socket.on('group-role-updated', handleRoleChange);
    Socket.on('group-member-added', handleMemberAdded);
    Socket.on('group-member-changed', handleMemberChanged);
    Socket.on('group-picture-updated', handleGroupPicture);
    Socket.on('profile-picture-updated', handleProfilePicture);
    Socket.on('group-channel-created', handleChannelCreated);
    Socket.on('group-channel-updated', handleChannelUpdated);
    Socket.on('group-channel-archived', handleChannelArchived);
    return () => {
      Socket.off('group-member-removed', handleRemoved);
      Socket.off('group-role-updated', handleRoleChange);
      Socket.off('group-member-added', handleMemberAdded);
      Socket.off('group-member-changed', handleMemberChanged);
      Socket.off('group-picture-updated', handleGroupPicture);
      Socket.off('profile-picture-updated', handleProfilePicture);
      Socket.off('group-channel-created', handleChannelCreated);
      Socket.off('group-channel-updated', handleChannelUpdated);
      Socket.off('group-channel-archived', handleChannelArchived);
    };
  }, [currentUser?._id, activeGroup?._id, groups]);

  const refreshMembers = async (group) => {
    setError('');
    try {
      const [memberResponse, userResponse, channelResponse] = await Promise.all([
        axios.get(`${apiUrl}/api/groups/${group._id}/members`, authConfig()),
        axios.get(`${apiUrl}/api/users`, authConfig()),
        group.groupType === 'community'
          ? axios.get(`${apiUrl}/api/groups/${group._id}/channels`, authConfig())
          : Promise.resolve({ data: { channels: [] } }),
      ]);
      setMembers(memberResponse.data);
      setChannels(channelResponse.data.channels || []);
      setUsers(userResponse.data.filter((candidate) =>
        !memberResponse.data.some((member) => String(member._id) === String(candidate._id))
      ));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load group members.');
    }
  };

  const showManagement = async (group) => {
    const next = activeGroup?._id === group._id ? null : group;
    setActiveGroup(next);
    if (next) await refreshMembers(next);
    else setChannels([]);
  };

  const createGroup = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      const { data } = await axios.post(`${apiUrl}/api/groups`, { name, groupType }, authConfig());
      setGroups((previous) => [...previous, data]);
      setName('');
      setGroupType('standard');
      await showManagement(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create group.');
    }
  };

  const createChannel = async (event) => {
    event.preventDefault();
    if (!activeGroup || !newChannelName.trim()) return;
    setError('');
    try {
      const { data } = await axios.post(
        `${apiUrl}/api/groups/${activeGroup._id}/channels`,
        { name: newChannelName, postingMode: channelPostingMode },
        authConfig()
      );
      setChannels((previous) => [...previous, data].sort((a, b) => a.sortOrder - b.sortOrder));
      setNewChannelName('');
      setChannelPostingMode('members');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create channel.');
    }
  };

  const updateChannelPostingMode = async (channel, postingMode) => {
    try {
      const { data } = await axios.patch(
        `${apiUrl}/api/groups/${activeGroup._id}/channels/${channel._id}`,
        { postingMode },
        authConfig()
      );
      setChannels((previous) => previous.map((item) => String(item._id) === String(data._id) ? data : item));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update channel permissions.');
    }
  };

  const archiveChannel = async (channel) => {
    if (!activeGroup || !window.confirm(`Archive #${channel.slug}? Its messages will be retained.`)) return;
    try {
      await axios.delete(`${apiUrl}/api/groups/${activeGroup._id}/channels/${channel._id}`, authConfig());
      setChannels((previous) => previous.filter((item) => String(item._id) !== String(channel._id)));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not archive channel.');
    }
  };

  const addMember = async (event) => {
    event.preventDefault();
    if (!activeGroup || !newMemberId) return;
    try {
      await axios.post(`${apiUrl}/api/groups/${activeGroup._id}/members`, { userId: newMemberId }, authConfig());
      setNewMemberId('');
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not add member.');
    }
  };

  const updateRole = async (member, role) => {
    try {
      await axios.patch(`${apiUrl}/api/groups/${activeGroup._id}/members/${member._id}`, { role }, authConfig());
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update role.');
    }
  };

  const removeMember = async (member) => {
    try {
      await axios.delete(`${apiUrl}/api/groups/${activeGroup._id}/members/${member._id}`, authConfig());
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not remove member.');
    }
  };

  const uploadGroupAvatar = async (group, file) => {
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) {
      setError('Group images must be 5 MB or smaller.');
      return;
    }
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const { data } = await axios.post(
        `${apiUrl}/api/groups/${group._id}/avatar`,
        formData,
        authConfig()
      );
      setGroups((previous) => previous.map((candidate) => String(candidate._id) === String(group._id)
        ? { ...candidate, avatarUrl: data.avatarUrl }
        : candidate));
      setActiveGroup((previous) => previous && String(previous._id) === String(group._id)
        ? { ...previous, avatarUrl: data.avatarUrl }
        : previous);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update the group image.');
    }
  };

  const visibleGroups = groups.filter((group) => group.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="text-white">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">Your groups</h3>
        <span className="text-xs text-gray-400">{groups.length}</span>
      </div>
      <form onSubmit={createGroup} className="mb-4 flex gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          placeholder="New group"
          className="min-w-0 flex-1 rounded-md border border-gray-600 bg-gray-900/70 px-2.5 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
          aria-label="New group name"
        />
        <select
          value={groupType}
          onChange={(event) => setGroupType(event.target.value)}
          aria-label="Group type"
          className="max-w-[108px] rounded-md border border-gray-600 bg-gray-900 px-1.5 text-xs text-white"
        >
          <option value="standard">Standard</option>
          <option value="community">Community</option>
        </select>
        <button type="submit" disabled={!name.trim()} className="grid aspect-square place-items-center rounded-md bg-cyan-600 text-white transition hover:bg-cyan-500 disabled:opacity-40" title="Create group" aria-label="Create group">
          <FaPlus size={11} />
        </button>
      </form>
      <ul className="space-y-1.5">
        {!loading && visibleGroups.length === 0 && <li className="rounded-md border border-dashed border-gray-700 px-3 py-4 text-center text-xs text-gray-400">No groups found</li>}
        {visibleGroups.map((group) => (
          <li key={group._id} className={`rounded-xl border transition ${activeGroup?._id === group._id ? 'border-teal-200/30 bg-teal-300/[0.1]' : 'border-white/[0.07] bg-white/[0.045] hover:bg-white/[0.08]'}`}>
            <div className="flex items-center gap-2 px-2.5 py-2">
              <Avatar src={group.avatarUrl} name={group.name} group className="h-9 w-9 text-sm" />
              <button
                type="button"
                onClick={() => group.groupType === 'community'
                  ? showManagement(group)
                  : onSelectGroup?.({ ...group, type: 'group' })}
                className="min-w-0 flex-1 text-left"
                title={group.groupType === 'community' ? `Open channels in ${group.name}` : `Open ${group.name}`}
              >
                <span className="block truncate text-sm font-semibold">{group.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-white/55">
                  <FaUsers size={10} /> {group.members} · {group.role}
                </span>
              </button>
              <button
                type="button"
                onClick={() => showManagement(group)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded text-gray-300 transition hover:bg-gray-600 hover:text-white"
                aria-label={`Manage ${group.name}`}
                title="Members and roles"
              >
                {activeGroup?._id === group._id ? <FaChevronUp size={11} /> : <FaChevronDown size={11} />}
              </button>
            </div>
            {activeGroup?._id === group._id && (
              <div className="border-t border-gray-600 px-2.5 py-2.5">
                {group.groupType === 'community' && (
                  <section className="mb-3 border-b border-white/10 pb-3" aria-label={`${group.name} channels`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase text-gray-300">Channels</span>
                      <span className="text-[10px] text-gray-400">{channels.length}</span>
                    </div>
                    {group.role === 'admin' && (
                      <form onSubmit={createChannel} className="mb-2 space-y-1.5">
                        <input
                          value={newChannelName}
                          onChange={(event) => setNewChannelName(event.target.value)}
                          maxLength={60}
                          placeholder="Channel name"
                          aria-label="New channel name"
                          className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-white"
                        />
                        <div className="flex gap-1">
                          <select
                            value={channelPostingMode}
                            onChange={(event) => setChannelPostingMode(event.target.value)}
                            aria-label="Channel posting permissions"
                            className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-1.5 py-1.5 text-[11px] text-white"
                          >
                            <option value="members">All members can post</option>
                            <option value="admins">Leaders only</option>
                          </select>
                          <button type="submit" disabled={!newChannelName.trim()} className="grid w-7 place-items-center rounded bg-cyan-600 text-white disabled:opacity-40" aria-label="Create channel" title="Create channel">
                            <FaPlus size={10} />
                          </button>
                        </div>
                      </form>
                    )}
                    <ul className="space-y-1">
                      {channels.map((channel) => (
                        <li key={channel._id} className="flex items-center gap-1 rounded bg-gray-900/60 px-2 py-1">
                          <button
                            type="button"
                            onClick={() => onSelectGroup?.({
                              ...group,
                              type: 'group',
                              channelId: channel._id,
                              channelName: channel.name,
                            })}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs hover:text-teal-300"
                            title={`Open ${channel.name}`}
                          >
                            <FaHashtag className="shrink-0 text-[10px]" />
                            <span className="truncate">{channel.name}</span>
                          </button>
                          {group.role === 'admin' && (
                            <>
                              <select
                                value={channel.postingMode}
                                onChange={(event) => updateChannelPostingMode(channel, event.target.value)}
                                aria-label={`${channel.name} posting permissions`}
                                className="max-w-[74px] rounded bg-gray-700 px-1 py-0.5 text-[9px] text-white"
                              >
                                <option value="members">Members</option>
                                <option value="admins">Leaders</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => archiveChannel(channel)}
                                disabled={channel.slug === 'general' || channels.length < 2}
                                aria-label={`Archive ${channel.name}`}
                                title="Archive channel"
                                className="grid h-6 w-6 place-items-center rounded text-gray-400 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-30"
                              >
                                <FaArchive size={10} />
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase text-gray-300">Members</span>
                  <span className="text-[10px] text-gray-400">{group.role === 'admin' ? 'Admin controls' : 'View only'}</span>
                </div>
                {group.role === 'admin' && (
                  <label className="mb-2 inline-flex cursor-pointer items-center gap-1.5 rounded border border-white/10 px-2 py-1.5 text-[11px] text-gray-200 transition hover:bg-white/10">
                    <FaCamera size={10} /> Change group photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                      className="sr-only"
                      aria-label={`Change ${group.name} photo`}
                      onChange={(event) => {
                        uploadGroupAvatar(group, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                )}
                {group.role === 'admin' && (
                  <form onSubmit={addMember} className="mb-2 flex gap-1">
                    <select
                      value={newMemberId}
                      onChange={(event) => setNewMemberId(event.target.value)}
                      className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-1.5 py-1.5 text-xs text-white"
                      aria-label="Choose a user to add"
                    >
                      <option value="">Add someone...</option>
                      {users.map((candidate) => <option key={candidate._id} value={candidate._id}>{candidate.username}</option>)}
                    </select>
                    <button type="submit" disabled={!newMemberId} className="grid w-7 place-items-center rounded bg-cyan-600 text-white disabled:opacity-40" title="Add member" aria-label="Add member">
                      <FaPlus size={10} />
                    </button>
                  </form>
                )}
                {error && <p role="alert" className="mb-2 text-[11px] text-rose-300">{error}</p>}
                <ul className="space-y-1">
                  {members.map((member) => (
                    <li key={member._id} className="flex min-w-0 items-center gap-1.5 rounded bg-gray-900/60 px-2 py-1.5">
                      <Avatar src={member.profilePicture || member.googlePicture} name={member.username} className="h-6 w-6 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-xs" title={member.email}>{member.username}</span>
                      {member.role === 'admin' && <FaCrown className="shrink-0 text-amber-300" size={10} title="Admin" />}
                      {group.role === 'admin' ? (
                        <>
                          <select
                            value={member.role}
                            onChange={(event) => updateRole(member, event.target.value)}
                            className="max-w-[72px] rounded bg-gray-700 px-1 py-0.5 text-[10px] text-white"
                            aria-label={`Role for ${member.username}`}
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                          <button type="button" onClick={() => removeMember(member)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-rose-500/20 hover:text-rose-300" title={`Remove ${member.username}`} aria-label={`Remove ${member.username}`}>
                            <FaUserMinus size={11} />
                          </button>
                        </>
                      ) : <span className="text-[10px] text-gray-400">{member.role}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
