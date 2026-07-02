import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * The Polaris Chakra system: default Chakra tokens (their semantic tokens
 * already flip on the `.dark` root class that <ColorModeProvider> manages)
 * plus the visual identity of the runtime's structure-only `polaris-*`
 * class names. Charts have their own token set (panels-builtin ChartTheme);
 * the shared accent below matches its first categorical slot.
 */
const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          500: { value: "#2a78d6" },
          600: { value: "#2263b2" },
        },
      },
    },
  },
  globalCss: {
    ".polaris-dashboard": {
      display: "flex",
      flexDirection: "column",
      gap: "6",
    },
    ".polaris-grid-title": {
      fontSize: "md",
      fontWeight: "semibold",
      color: "fg",
      marginBottom: "2",
    },
    ".polaris-panel": {
      backgroundColor: "bg.panel",
      borderWidth: "1px",
      borderColor: "border",
      borderRadius: "md",
      boxShadow: "xs",
    },
    ".polaris-panel-header": {
      paddingX: "3",
      paddingTop: "2",
    },
    ".polaris-panel-title": {
      fontSize: "sm",
      fontWeight: "medium",
      color: "fg",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".polaris-panel-unknown, .polaris-panel-error": {
      padding: "3",
      fontSize: "sm",
    },
    ".polaris-panel-unknown": {
      color: "fg.muted",
    },
    ".polaris-panel-error": {
      color: "fg.error",
    },
  },
});

export const polarisSystem = createSystem(defaultConfig, config);
