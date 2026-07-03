// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withSpecValue } from "../src/editor/controls";
import { GaugeEditor } from "../src/gauge/editor";
import { TimeSeriesEditor } from "../src/time-series/editor";

afterEach(cleanup);

describe("withSpecValue", () => {
  it("sets values and drops defaults so specs stay minimal", () => {
    expect(withSpecValue({}, "unit", "bytes")).toEqual({ unit: "bytes" });
    expect(withSpecValue({ unit: "bytes" }, "unit", "")).toEqual({});
    expect(withSpecValue({ stack: true }, "stack", false)).toEqual({});
    expect(withSpecValue({ min: 0 }, "min", undefined)).toEqual({});
  });
});

describe("TimeSeriesEditor", () => {
  it("reports the next spec on change without touching other keys", () => {
    const onChange = vi.fn();
    render(<TimeSeriesEditor spec={{ unit: "bytes" }} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Stack series"));
    expect(onChange).toHaveBeenCalledWith({ unit: "bytes", stack: true });
  });

  it("removes the legend block when reset to the default", () => {
    const onChange = vi.fn();
    render(
      <TimeSeriesEditor
        spec={{ legend: { position: "right" } }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Legend"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe("GaugeEditor", () => {
  it("adds and removes threshold rows", () => {
    const onChange = vi.fn();
    render(<GaugeEditor spec={{}} onChange={onChange} />);

    fireEvent.click(screen.getByText("Add threshold"));
    expect(onChange).toHaveBeenCalledWith({
      thresholds: [{ value: 80, status: "warning" }],
    });

    cleanup();
    onChange.mockClear();
    render(
      <GaugeEditor
        spec={{ thresholds: [{ value: 80, status: "warning" }] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Remove"));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
