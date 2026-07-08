import { useChartTheme } from "./theme";

/** Empty-result placeholder shared by the built-in panels. */
export function NoData() {
  const theme = useChartTheme();
  return (
    <div
      className="dashglass-panel-nodata"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.ink.muted,
        fontSize: 13,
      }}
    >
      No data
    </div>
  );
}
