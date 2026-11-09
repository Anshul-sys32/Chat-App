package com.nfang.chatapp;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "MessageNotifications",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class MessageNotificationPlugin extends Plugin {
    private static final String CHANNEL_ID = "chat-messages-silent-v2";
    private static final String CHANNEL_NAME = "Chat messages";

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermission(call, NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            resolvePermission(call, NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        resolvePermission(call, getPermissionState("notifications") == PermissionState.GRANTED
            && NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
    }

    @PluginMethod
    public void playSound(PluginCall call) {
        Context context = getContext();
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null || audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION) == 0) {
            call.resolve();
            return;
        }
        ToneGenerator toneGenerator = null;
        try {
            toneGenerator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 75);
            if (!toneGenerator.startTone(ToneGenerator.TONE_PROP_ACK, 180)) {
                toneGenerator.release();
                call.resolve();
                return;
            }
            ToneGenerator activeTone = toneGenerator;
            new Handler(Looper.getMainLooper()).postDelayed(activeTone::release, 300);
            call.resolve();
        } catch (RuntimeException error) {
            if (toneGenerator != null) toneGenerator.release();
            call.reject("Could not play the notification sound.", error);
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notification permission has not been granted.");
            return;
        }

        String title = call.getString("title", "New message");
        String body = call.getString("body", "You received a new message.");
        String notificationId = call.getString("notificationId", String.valueOf(System.currentTimeMillis()));
        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("Android notification service is unavailable.");
            return;
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            call.reject("Notifications are disabled for this app.");
            return;
        }
        ensureChannel(manager);

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launchIntent.putExtra("chatTargetType", call.getString("targetType", ""));
            launchIntent.putExtra("chatTargetId", call.getString("targetId", ""));
            launchIntent.putExtra("chatTargetName", call.getString("targetName", ""));
            launchIntent.putExtra("chatTargetChannelId", call.getString("targetChannelId", ""));
            launchIntent.putExtra("chatTargetChannelName", call.getString("targetChannelName", ""));
            launchIntent.putExtra("chatNotificationId", notificationId);
        }
        PendingIntent contentIntent = launchIntent == null ? null : PendingIntent.getActivity(
            context,
            notificationId.hashCode(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(0)
            .setSound(null)
            .setVibrate(new long[0])
            .setAutoCancel(true);
        if (contentIntent != null) builder.setContentIntent(contentIntent);

        manager.notify(notificationId.hashCode(), builder.build());
        call.resolve();
    }

    private void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject target = notificationTargetFrom(intent);
        if (target != null) notifyListeners("notificationTap", target, true);
    }

    private JSObject notificationTargetFrom(Intent intent) {
        if (intent == null) return null;
        String targetType = intent.getStringExtra("chatTargetType");
        String targetId = intent.getStringExtra("chatTargetId");
        if (targetType == null || targetType.isEmpty() || targetId == null || targetId.isEmpty()) return null;
        JSObject target = new JSObject();
        target.put("targetType", targetType);
        target.put("targetId", targetId);
        target.put("targetName", intent.getStringExtra("chatTargetName"));
        target.put("targetChannelId", intent.getStringExtra("chatTargetChannelId"));
        target.put("targetChannelName", intent.getStringExtra("chatTargetChannelName"));
        target.put("notificationId", intent.getStringExtra("chatNotificationId"));
        intent.removeExtra("chatTargetType");
        intent.removeExtra("chatTargetId");
        intent.removeExtra("chatTargetName");
        intent.removeExtra("chatTargetChannelId");
        intent.removeExtra("chatTargetChannelName");
        intent.removeExtra("chatNotificationId");
        return target;
    }

    private void resolvePermission(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }
}