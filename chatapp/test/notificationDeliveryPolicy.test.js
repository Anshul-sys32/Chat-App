import assert from "node:assert/strict";
import test from "node:test";
import { requestMessageNotificationPermission } from "../src/messageNotificationDelivery.js";
import {
  createNotificationIdDeduper,
  getMessageNotificationActions,
  normalizeNotificationTarget,
} from "../src/notificationDeliveryPolicy.js";

test("notification sounds and system alerts follow independent preferences", () => {
  assert.deepEqual(getMessageNotificationActions({
    categoryEnabled: true,
    isHidden: true,
    browserNotifications: false,
    notificationSounds: true,
  }), { showSystemNotification: false, playSound: true });
  assert.deepEqual(getMessageNotificationActions({
    categoryEnabled: true,
    isHidden: true,
    browserNotifications: true,
    notificationSounds: false,
  }), { showSystemNotification: true, playSound: false });
  assert.deepEqual(getMessageNotificationActions({
    categoryEnabled: true,
    isHidden: true,
    browserNotifications: true,
    notificationSounds: true,
  }), { showSystemNotification: true, playSound: true });
});

test("visible app and disabled message categories do not deliver alerts", () => {
  assert.deepEqual(getMessageNotificationActions({
    categoryEnabled: true,
    isHidden: false,
    browserNotifications: true,
    notificationSounds: true,
  }), { showSystemNotification: false, playSound: false });
  assert.deepEqual(getMessageNotificationActions({
    categoryEnabled: false,
    isHidden: true,
    browserNotifications: true,
    notificationSounds: true,
  }), { showSystemNotification: false, playSound: false });
});

test("duplicate delivery IDs are accepted once", () => {
  const shouldAccept = createNotificationIdDeduper();
  assert.equal(shouldAccept("group-71"), true);
  assert.equal(shouldAccept("group-71"), false);
  assert.equal(shouldAccept("direct-72"), true);
  assert.equal(shouldAccept(""), true);
});

test("browser notification permission denial is reported as denied", async () => {
  const originalWindow = globalThis.window;
  const originalNotification = globalThis.Notification;
  const deniedNotification = {
    permission: "denied",
    requestPermission: async () => "denied",
  };
  globalThis.window = { Notification: deniedNotification };
  globalThis.Notification = deniedNotification;
  try {
    assert.equal(await requestMessageNotificationPermission(), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
  }
});

test("notification targets map to exact direct and community conversations", () => {
  assert.deepEqual(normalizeNotificationTarget({
    targetType: "direct",
    targetId: 7,
    targetName: "Sam",
  }), { _id: 7, type: "user", username: "Sam" });
  assert.deepEqual(normalizeNotificationTarget({
    targetType: "group",
    targetId: 19,
    targetName: "Community",
    targetChannelId: 5,
    targetChannelName: "announcements",
  }), {
    _id: 19,
    type: "group",
    name: "Community",
    channelId: 5,
    channelName: "announcements",
  });
  assert.equal(normalizeNotificationTarget({ targetType: "direct", targetId: "bad" }), null);
});