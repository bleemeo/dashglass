import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { parseDuration, type Duration, type Variable } from "@dashglass/model";

import { anonymousAuth, type AuthProvider } from "./auth";
import {
  resolveTimeRange,
  type AbsoluteTimeRange,
  type PrometheusDataSource,
  type TimeRange,
} from "./datasource";
import { interpolate, type VariableValues } from "./interpolate";
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
  // Nullable on purpose: the provider works without a runtime (tests).
  const runtime = useContext(RuntimeContext);

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
      refresh: () => {
        // An absolute range resolves to the same dates, so the bumped
        // epoch alone would replay the orchestrator cache — re-execute
        // its entries instead (this is also the errored-panel retry).
        if (!("pastDuration" in range)) {
          runtime?.orchestrator.invalidate();
        }
        setEpoch((tick) => tick + 1);
      },
    }),
    // epoch re-resolves relative ranges against a new "now".
    [range, epoch, runtime],
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
  /** Load failures by variable name, so selector UIs can surface them
   * (an empty dropdown alone reads as "no data", not "it broke"). */
  errors: Record<string, string>;
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

/**
 * Deep-interpolates every string in a variable source's spec with the
 * current variable values, so a chained matcher such as
 * `up{instance=~"$instance"}` resolves before the source queries. The spec
 * is plugin-opaque, so this walks it generically rather than assuming
 * field names.
 */
function interpolateSpec(spec: unknown, values: VariableValues): unknown {
  if (typeof spec === "string") {
    return interpolate(spec, values);
  }
  if (Array.isArray(spec)) {
    return spec.map((item) => interpolateSpec(item, values));
  }
  if (spec && typeof spec === "object") {
    return Object.fromEntries(
      Object.entries(spec).map(([key, value]) => [
        key,
        interpolateSpec(value, values),
      ]),
    );
  }
  return spec;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const listVariables = variables.filter((v) => v.kind === "ListVariable");
  const [loading, setLoading] = useState(listVariables.length > 0);

  // Loading uses the time range current at mount (or variables change) but
  // does not re-run on refresh ticks: label values move slowly, reloading
  // them on every tick would be wasteful.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  // Interpolated spec last used to load each variable's options; lets a
  // dependent variable ("chained": its matcher references $another) reload
  // only when its resolved spec actually changes, and stops the load →
  // setValues → effect loop for variables whose spec is unaffected.
  const loadedSpecs = useRef<Record<string, string>>({});

  // When the variable definitions themselves change (e.g. editing the
  // dashboard), reseed text values and force every list to reload.
  const definitionsKey = JSON.stringify(variables);
  useEffect(() => {
    loadedSpecs.current = {};
    setValues({ ...textValues(variables), ...initialRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by definitionsKey
  }, [definitionsKey]);

  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    const listVariables = variables.filter((v) => v.kind === "ListVariable");
    if (listVariables.length === 0) {
      setOptions({});
      loadedSpecs.current = {};
      setLoading(false);
      return;
    }

    // Names of list variables in this dashboard: a spec still mentioning
    // one of them (as $name / ${name}) after interpolation is waiting on a
    // parent that has not loaded yet — defer it rather than query with a
    // half-resolved matcher.
    const listNames = listVariables.map((v) => v.spec.name);
    const stillReferences = (key: string) =>
      listNames.some((name) =>
        new RegExp(`\\$\\{?${name}\\b`).test(key),
      );

    // A variable is (re)loaded when its spec, interpolated with the current
    // variable values, differs from what it was last loaded with.
    const pending = listVariables
      .map((variable) => {
        const spec = interpolateSpec(
          variable.spec.plugin.spec ?? {},
          values,
        ) as Record<string, unknown>;
        return { variable, spec, key: JSON.stringify(spec) };
      })
      .filter(
        ({ variable, key }) =>
          loadedSpecs.current[variable.spec.name] !== key &&
          !stillReferences(key),
      );
    if (pending.length === 0) {
      return; // nothing depends on what changed → no reload, no loop
    }
    setLoading(true);
    let cancelled = false;

    Promise.all(
      pending.map(async ({ variable, spec, key }) => {
        const plugin = registries.variableSources.get(variable.spec.plugin.kind);
        const loaded: string[] = [];
        let error: string | null = null;
        if (plugin) {
          try {
            loaded.push(
              ...(await plugin.loadValues(spec, {
                datasource,
                timeRange: resolvedRef.current,
              })),
            );
          } catch (loadError) {
            error = String(loadError);
          }
        }
        return { variable, loaded, key, error };
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setOptions((current) => {
        const next = { ...current };
        for (const { variable, loaded } of results) {
          next[variable.spec.name] = loaded;
        }
        return next;
      });
      setErrors((current) => {
        const next = { ...current };
        for (const { variable, error } of results) {
          if (error === null) {
            delete next[variable.spec.name];
          } else {
            next[variable.spec.name] = error;
          }
        }
        return next;
      });
      setValues((current) => {
        const next = { ...current };
        for (const { variable, loaded } of results) {
          const spec = variable.spec;
          const chosen =
            spec.defaultValue ??
            (spec.allowAllValue ? ".+" : (loaded[0] ?? ""));
          const existing = next[spec.name];
          // Keep the current selection if it is still a valid option;
          // otherwise fall back to the default (a chained child whose
          // parent changed usually needs resetting).
          const stillValid =
            typeof existing === "string" &&
            existing !== "" &&
            (existing === ".+" || loaded.includes(existing));
          next[spec.name] = stillValid ? existing : chosen;
        }
        return next;
      });
      for (const { variable, key } of results) {
        loadedSpecs.current[variable.spec.name] = key;
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- valuesKey drives chained reloads; JSON keys keep it stable
  }, [JSON.stringify(variables), valuesKey, datasource, registries]);

  const value = useMemo<VariablesContextValue>(
    () => ({
      values,
      options,
      loading,
      errors,
      setValue: (name, newValue) =>
        setValues((current) => ({ ...current, [name]: newValue })),
    }),
    [values, options, loading, errors],
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

/**
 * Pins a subset of variable values for its subtree, re-providing the
 * surrounding variables context with those overrides merged in. Used by
 * repeated panels: each instance pins the repeat variable to its own value
 * so the panel's queries interpolate to that value while everything else
 * (loading, options, other variables) still comes from the parent. No
 * effects and no reloading — this is a value overlay only.
 */
export function PinnedVariablesProvider({
  overrides,
  children,
}: {
  overrides: VariableValues;
  children: ReactNode;
}) {
  const parent = useVariables();
  const overridesKey = JSON.stringify(overrides);
  const value = useMemo<VariablesContextValue>(
    () => ({ ...parent, values: { ...parent.values, ...overrides } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overridesKey stands in for overrides
    [parent, overridesKey],
  );
  return <VariablesContext value={value}>{children}</VariablesContext>;
}
