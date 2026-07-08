import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import type { Variable } from "@dashglass/model";

import {
  RuntimeProvider,
  TimeRangeProvider,
  VariablesProvider,
  createRegistries,
  useVariables,
  type PrometheusDataSource,
  type VariableSourcePlugin,
} from "../src";

function stubDatasource(): PrometheusDataSource {
  return {
    rangeQuery: vi.fn(),
    instantQuery: vi.fn(),
    labelNames: vi.fn(),
    labelValues: vi.fn(),
  };
}

// A variable source whose returned values depend on the (interpolated)
// matcher it receives — so a chained matcher can be observed resolving.
const seenMatchers: string[] = [];
const labelValuesSource: VariableSourcePlugin = {
  kind: "PrometheusLabelValuesVariable",
  async loadValues(spec) {
    const matcher = Array.isArray(spec["matchers"])
      ? String(spec["matchers"][0] ?? "")
      : "";
    seenMatchers.push(matcher);
    if (spec["labelName"] === "instance") {
      return ["web-1", "web-2"];
    }
    // Disks depend on the selected instance.
    if (matcher.includes("web-1")) {
      return ["/", "/data"];
    }
    if (matcher.includes("web-2")) {
      return ["/", "/var"];
    }
    return [];
  },
};

function Probe() {
  const { values, options } = useVariables();
  return (
    <div>
      <span data-testid="instance">{String(values["instance"] ?? "")}</span>
      <span data-testid="disk">{String(values["disk"] ?? "")}</span>
      <span data-testid="disk-options">
        {(options["disk"] ?? []).join(",")}
      </span>
    </div>
  );
}

function renderWith(variables: Variable[], setValue?: (fn: (v: string) => void) => void) {
  const registries = createRegistries();
  registries.variableSources.register(labelValuesSource);
  return render(
    <RuntimeProvider datasource={stubDatasource()} registries={registries}>
      <TimeRangeProvider>
        <VariablesProvider variables={variables}>
          <Probe />
          {setValue ? <Setter onReady={setValue} /> : null}
        </VariablesProvider>
      </TimeRangeProvider>
    </RuntimeProvider>,
  );
}

function Setter({ onReady }: { onReady: (fn: (v: string) => void) => void }) {
  const { setValue } = useVariables();
  onReady((v: string) => setValue("instance", v));
  return null;
}

const chained: Variable[] = [
  {
    kind: "ListVariable",
    spec: {
      name: "instance",
      plugin: {
        kind: "PrometheusLabelValuesVariable",
        spec: { labelName: "instance" },
      },
    },
  },
  {
    kind: "ListVariable",
    spec: {
      name: "disk",
      plugin: {
        kind: "PrometheusLabelValuesVariable",
        spec: {
          labelName: "device",
          matchers: ['node_disk{instance=~"$instance"}'],
        },
      },
    },
  },
];

describe("chained variables", () => {
  it("interpolates a dependent matcher and resolves child options", async () => {
    seenMatchers.length = 0;
    renderWith(chained);

    await waitFor(() => {
      expect(screen.getByTestId("instance").textContent).toBe("web-1");
      expect(screen.getByTestId("disk-options").textContent).toBe("/,/data");
    });

    // The child was queried with $instance resolved, never with a literal.
    expect(seenMatchers).toContain('node_disk{instance=~"web-1"}');
    expect(
      seenMatchers.every((m) => !m.includes("$instance")),
    ).toBe(true);
  });

  it("reloads and resets the child when the parent changes", async () => {
    seenMatchers.length = 0;
    let setInstance: (v: string) => void = () => {};
    renderWith(chained, (fn) => {
      setInstance = fn;
    });

    await waitFor(() =>
      expect(screen.getByTestId("disk-options").textContent).toBe("/,/data"),
    );

    setInstance("web-2");

    await waitFor(() => {
      expect(screen.getByTestId("disk-options").textContent).toBe("/,/var");
    });
    // '/data' no longer exists under web-2 → the child reset to the first.
    expect(screen.getByTestId("disk").textContent).toBe("/");
    expect(seenMatchers).toContain('node_disk{instance=~"web-2"}');
  });
});
