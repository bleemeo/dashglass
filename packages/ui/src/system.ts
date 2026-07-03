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
    // Plugin option editors (panels-builtin editor/controls.tsx) are
    // structure-only, like the panel chrome; this is their identity.
    ".polaris-fields": {
      display: "flex",
      flexDirection: "column",
      gap: "3",
    },
    ".polaris-field": {
      display: "flex",
      flexDirection: "column",
      gap: "1",
    },
    ".polaris-field-inline": {
      flexDirection: "row",
      alignItems: "center",
      gap: "2",
    },
    ".polaris-field-label": {
      fontSize: "sm",
      fontWeight: "medium",
      color: "fg",
    },
    ".polaris-field-input": {
      fontSize: "sm",
      paddingX: "2",
      paddingY: "1",
      borderWidth: "1px",
      borderColor: "border",
      borderRadius: "sm",
      backgroundColor: "bg",
      color: "fg",
    },
    ".polaris-field-button": {
      fontSize: "xs",
      paddingX: "2",
      paddingY: "1",
      borderWidth: "1px",
      borderColor: "border",
      borderRadius: "sm",
      backgroundColor: "bg.subtle",
      color: "fg",
      cursor: "pointer",
      alignSelf: "flex-start",
      _hover: { backgroundColor: "bg.muted" },
    },
    ".polaris-threshold-rows": {
      display: "flex",
      flexDirection: "column",
      gap: "1",
    },
    ".polaris-threshold-row": {
      display: "flex",
      gap: "1",
      alignItems: "center",
    },
    // PromQL editor (CodeMirror): input-like chrome around the editor; the
    // inner theme (light/dark) comes from the host's resolved color mode.
    ".polaris-promql-editor": {
      width: "100%",
      borderWidth: "1px",
      borderColor: "border",
      borderRadius: "sm",
      overflow: "hidden",
      "& .cm-editor": {
        fontSize: "13px",
        paddingBlock: "1",
      },
      "& .cm-editor.cm-focused": {
        outline: "none",
      },
      _focusWithin: {
        borderColor: "blue.500",
      },
    },
    // Markdown panel typography (the global reset strips element defaults).
    ".polaris-markdown": {
      padding: "3",
      fontSize: "sm",
      color: "fg",
      overflowY: "auto",
      height: "100%",
      "& h1, & h2, & h3": {
        fontWeight: "semibold",
        marginTop: "3",
        marginBottom: "1",
      },
      "& h1": { fontSize: "lg" },
      "& h2": { fontSize: "md" },
      "& h3": { fontSize: "sm" },
      "& h1:first-child, & h2:first-child, & h3:first-child": {
        marginTop: "0",
      },
      "& p": { marginBottom: "2" },
      "& ul, & ol": { paddingLeft: "5", marginBottom: "2" },
      "& ul": { listStyleType: "disc" },
      "& ol": { listStyleType: "decimal" },
      "& a": {
        color: "blue.600",
        textDecoration: "underline",
        _dark: { color: "blue.400" },
      },
      "& code": {
        fontFamily: "mono",
        fontSize: "xs",
        backgroundColor: "bg.muted",
        paddingX: "1",
        borderRadius: "xs",
      },
      "& pre": {
        backgroundColor: "bg.muted",
        padding: "2",
        borderRadius: "sm",
        overflowX: "auto",
        marginBottom: "2",
      },
      "& blockquote": {
        borderLeftWidth: "3px",
        borderColor: "border",
        paddingLeft: "3",
        color: "fg.muted",
        marginBottom: "2",
      },
    },
    // Dashboard editor grid: hover-revealed panel actions and a themed
    // react-grid-layout drop placeholder.
    ".polaris-editor-item": {
      position: "relative",
      height: "100%",
    },
    ".polaris-editor-item .polaris-editor-actions": {
      opacity: 0,
      transition: "opacity 0.15s",
    },
    ".polaris-editor-item:hover .polaris-editor-actions": {
      opacity: 1,
    },
    ".polaris-editor-item .polaris-panel-header": {
      cursor: "grab",
    },
    ".react-grid-item.react-grid-placeholder": {
      backgroundColor: "blue.500/30",
      borderRadius: "md",
    },
  },
});

export const polarisSystem = createSystem(defaultConfig, config);
