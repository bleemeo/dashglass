import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { parseDuration, type Duration, type Variable } from "@polarisui/model";

import { anonymousAuth, type AuthProvider } from "./auth";
import {
  resolveTimeRange,
  type AbsoluteTimeRange,
  type PrometheusDataSource,
  type TimeRange,
} from "./datasource";
import type { VariableValues } from "./interpolate";
import { QueryOrchestrator } from "./orchestrator";
import type { Registries } from "./registries";

// --- Runtime ---------------------------------------------------------------

export interface RuntimeContextValue {
  datasource: PrometheusDataSource;
  registries: Registries;
  orchestrator: QueryOrchestrator;
  auth: AuthProvider;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export interface RuntimeProviderProps {
  datasource: PrometheusDataSource;
  registries: Registries;
  auth?: AuthProvider;
  /** Injectable for tests; defaults to one orchestrator per datasource. */
  orchestrator?: QueryOrchestrator;
  children: ReactNode;
}

export function RuntimeProvider({
  datasource,
  registries,
  auth = anonymousAuth,
  orchestrator,
  children,
}: RuntimeProviderProps) {
  const value = useMemo<RuntimeContextValue>(
    () => ({
      datasource,
      registries,
      auth,
      orchestrator: orchestrator ?? new QueryOrchestrator(datasource),
    }),
    [datasource, registries, auth, orchestrator],
  );
  return <RuntimeContext value={value}>{children}</RuntimeContext>;
}

export function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) {
    throw new Error("useRuntime must be used inside <RuntimeProvider>");
  }
  return value;
}

// --- Time range --------------------------------------------------------------

export interface TimeRangeContextValue {
  range: TimeRange;
  /** The range resolved to absolute dates (refreshed on each tick). */
  resolved: AbsoluteTimeRange;
  setRange: (range: TimeRange) => void;
  refresh: () => void;
}

const TimeRangeContext = createContext<TimeRangeContextValue | null>(null);

export interface TimeRangeProviderProps {
  initialRange?: TimeRange;
  /** Auto-refresh interval; only relative ranges slide. */
  refreshInterval?: Duration | undefined;
  children: ReactNode;
}

export function TimeRangeProvider({
  initialRange = { pastDuration: "1h" },
  refreshInterval,
  children,
}: TimeRangeProviderProps) {
  const [range, setRange] = useState<TimeRange>(initialRange);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!refreshInterval) {
      return;
    }
    const interval = setInterval(
      () => setEpoch((tick) => tick + 1),
      parseDuration(refreshInterval),
    );
    return () => clearInterval(interval);
  }, [refreshInterval]);

  const value = useMemo<TimeRangeContextValue>(
    () => ({
      range,
      resolved: resolveTimeRange(range),
      setRange,
      refresh: () => setEpoch((tick) => tick + 1),
    }),
    // epoch re-resolves relative ranges against a new "now".
    [range, epoch],
  );
  return <TimeRangeContext value={value}>{children}</TimeRangeContext>;
}

export function useTimeRange(): TimeRangeContextValue {
  const value = useContext(TimeRangeContext);
  if (!value) {
    throw new Error("useTimeRange must be used inside <TimeRangeProvider>");
  }
  return value;
}

// --- Variables ---------------------------------------------------------------

export interface VariablesContextValue {
  values: VariableValues;
  /** Options loaded for each ListVariable, for selector UIs. */
  options: Record<string, string[]>;
  setValue: (name: string, value: string | string[]) => void;
  /** True while ListVariable values are loading. */
  loading: boolean;
}

const VariablesContext = createContext<VariablesContextValue | null>(null);

function textValues(variables: Variable[]): VariableValues {
  const values: VariableValues = {};
  for (const variable of variables) {
    if (variable.kind === "TextVariable") {
      values[variable.spec.name] = variable.spec.value;
    }
  }
  return values;
}

export interface VariablesProviderProps {
  variables?: Variable[] | undefined;
  /**
   * Seed values (e.g. restored from the URL), taking precedence over the
   * variables' own defaults. Read once at mount.
   */
  initialValues?: VariableValues | undefined;
  children: ReactNode;
}

export function VariablesProvider({
  variables = [],
  initialValues,
  children,
}: VariablesProviderProps) {
  const { datasource, registries } = useRuntime();
  const { resolved } = useTimeRange();
  const initialRef = useRef(initialValues);
  const [values, setValues] = useState<VariableValues>(() => ({
    ...textValues(variables),
    ...initialRef.current,
  }));
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const listVariables = variables.filter((v) => v.kind === "ListVariable");
  const [loading, setLoading] = useState(listVariables.length > 0);

  // Loading uses the time range current at mount (or variables change) but
  // does not re-run on refresh ticks: label values move slowly, reloading
  // them on every tick would be wasteful.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  useEffect(() => {
    setValues({ ...textValues(variables), ...initialRef.current });
    const listVariables = variables.filter((v) => v.kind === "ListVariable");
    if (listVariables.length === 0) {
      setOptions({});
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;

    Promise.all(
      listVariables.map(async (variable) => {
        const plugin = registries.variableSources.get(variable.spec.plugin.kind);
        const loaded = plugin
          ? await plugin
              .loadValues(variable.spec.plugin.spec ?? {}, {
                datasource,
                timeRange: resolvedRef.current,
              })
              .catch(() => [])
          : [];
        return [variable, loaded] as const;
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const loadedOptions: Record<string, string[]> = {};
      const defaults: VariableValues = {};
      for (const [variable, loaded] of results) {
        const spec = variable.spec;
        loadedOptions[spec.name] = loaded;
        defaults[spec.name] =
          spec.defaultValue ??
          (spec.allowAllValue ? ".+" : (loaded[0] ?? ""));
      }
      setOptions(loadedOptions);
      setValues((current) => ({ ...defaults, ...current }));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the variable definitions change
  }, [JSON.stringify(variables), datasource, registries]);

  const value = useMemo<VariablesContextValue>(
    () => ({
      values,
      options,
      loading,
      setValue: (name, newValue) =>
        setValues((current) => ({ ...current, [name]: newValue })),
    }),
    [values, options, loading],
  );
  return <VariablesContext value={value}>{children}</VariablesContext>;
}

export function useVariables(): VariablesContextValue {
  const value = useContext(VariablesContext);
  if (!value) {
    throw new Error("useVariables must be used inside <VariablesProvider>");
  }
  return value;
}
