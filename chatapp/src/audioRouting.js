import { Capacitor, registerPlugin } from "@capacitor/core";

const AudioRoute = registerPlugin("AudioRoute");

export const isNativeAudioRoutingAvailable = () =>
  Capacitor.isNativePlatform() && Boolean(AudioRoute);

export const listAudioRoutes = async () => {
  if (isNativeAudioRoutingAvailable()) {
    const { routes } = await AudioRoute.listRoutes();
    return routes || [];
  }
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audiooutput")
    .map((device) => ({
      id: device.deviceId,
      label: device.label || "Audio output",
      type: "browser",
    }));
};

export const selectAudioRoute = async (routeId, mediaElements = []) => {
  if (isNativeAudioRoutingAvailable()) {
    await AudioRoute.setRoute({ routeId });
    return;
  }
  const elementPromises = mediaElements
    .filter((element) => typeof element?.setSinkId === "function")
    .map((element) => element.setSinkId(routeId));
  if (!elementPromises.length) {
    throw new Error("This browser does not allow selecting an audio output.");
  }
  await Promise.all(elementPromises);
};
