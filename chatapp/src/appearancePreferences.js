export const ACCENT_OPTIONS = [
  { id: "cobalt", label: "Indigo", color: "#818cf8" },
  { id: "coral", label: "Coral", color: "#ff947d" },
  { id: "amber", label: "Amber", color: "#f2bf63" },
  { id: "rose", label: "Rose", color: "#f18ca8" },
];

export const readAccentPreference = () => {
  const savedAccent = localStorage.getItem("accentColor");
  return ACCENT_OPTIONS.some(({ id }) => id === savedAccent) ? savedAccent : "cobalt";
};