package com.nfang.chatapp;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {
    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void listRoutes(PluginCall call) {
        AudioManager manager = audioManager();
        List<JSObject> routes = new ArrayList<>();
        addRoute(routes, "speaker", "Speaker", "speaker");
        addRoute(routes, "earpiece", "Phone earpiece", "earpiece");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                String routeId = routeIdFor(device.getType());
                if (routeId != null && routes.stream().noneMatch(route -> routeId.equals(route.getString("id")))) {
                    String label = device.getProductName() == null || device.getProductName().length() == 0
                        ? routeLabel(routeId)
                        : device.getProductName().toString();
                    addRoute(routes, routeId, label, routeType(routeId));
                }
            }
        }

        JSObject result = new JSObject();
        result.put("routes", new JSArray(routes));
        call.resolve(result);
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String routeId = call.getString("routeId", "");
        if (!"speaker".equals(routeId) && !"earpiece".equals(routeId)
            && !"wired_headset".equals(routeId) && !"bluetooth".equals(routeId)
            && !"usb".equals(routeId) && !"other".equals(routeId)) {
            call.reject("Unsupported audio route.");
            return;
        }

        AudioManager manager = audioManager();
        manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if ("speaker".equals(routeId)) {
            manager.setSpeakerphoneOn(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setCommunicationDevice(manager, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
        } else {
            manager.setSpeakerphoneOn(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                int type = "earpiece".equals(routeId)
                    ? AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                    : "bluetooth".equals(routeId) ? AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    : "usb".equals(routeId) ? AudioDeviceInfo.TYPE_USB_HEADSET
                    : AudioDeviceInfo.TYPE_WIRED_HEADPHONES;
                setCommunicationDevice(manager, type);
            } else if ("bluetooth".equals(routeId)) {
                manager.startBluetoothSco();
                manager.setBluetoothScoOn(true);
            }
        }
        call.resolve();
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private void setCommunicationDevice(AudioManager manager, int type) {
        for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) {
            if (device.getType() == type) {
                manager.setCommunicationDevice(device);
                return;
            }
        }
    }

    private static String routeIdFor(int type) {
        if (type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return "speaker";
        if (type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return "earpiece";
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) return "wired_headset";
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET) return "bluetooth";
        if (type == AudioDeviceInfo.TYPE_USB_DEVICE || type == AudioDeviceInfo.TYPE_USB_HEADSET) return "usb";
        return "other";
    }

    private static String routeLabel(String routeId) {
        if ("wired_headset".equals(routeId)) return "Headphones";
        if ("bluetooth".equals(routeId)) return "Bluetooth";
        if ("usb".equals(routeId)) return "USB audio";
        return "Other audio output";
    }

    private static String routeType(String routeId) {
        return routeId;
    }

    private static void addRoute(List<JSObject> routes, String id, String label, String type) {
        JSObject route = new JSObject();
        route.put("id", id);
        route.put("label", label);
        route.put("type", type);
        routes.add(route);
    }
}
