import { useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Text,
  Textarea,
} from "@chakra-ui/react";

import type { ListVariable, TextVariable, Variable } from "@dashglass/model";

const VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const LABEL_VALUES_KIND = "PrometheusLabelValuesVariable";

function blankListVariable(name: string): ListVariable {
  return {
    kind: "ListVariable",
    spec: {
      name,
      plugin: { kind: LABEL_VALUES_KIND, spec: { labelName: "" } },
    },
  };
}

function uniqueName(existing: Variable[]): string {
  const taken = new Set(existing.map((variable) => variable.spec.name));
  if (!taken.has("var")) {
    return "var";
  }
  let counter = 2;
  while (taken.has(`var${counter}`)) {
    counter += 1;
  }
  return `var${counter}`;
}

/** The label-values source spec fields, read leniently (spec is opaque). */
function sourceSpec(variable: ListVariable): {
  labelName: string;
  matchers: string;
} {
  const spec = (variable.spec.plugin.spec ?? {}) as Record<string, unknown>;
  const matchers = Array.isArray(spec["matchers"])
    ? spec["matchers"].filter((m): m is string => typeof m === "string")
    : [];
  return {
    labelName: typeof spec["labelName"] === "string" ? spec["labelName"] : "",
    matchers: matchers.join("\n"),
  };
}

/** Per-variable validation problems, keyed by index. */
function validate(variables: Variable[]): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Map<string, number>();
  variables.forEach((variable, index) => {
    const name = variable.spec.name;
    if (!VARIABLE_NAME.test(name)) {
      problems.set(
        index,
        "Name must be letters, digits and '_', not starting with a digit.",
      );
    } else if (seen.has(name)) {
      problems.set(index, `Duplicate name "${name}".`);
    }
    seen.set(name, index);
    if (
      !problems.has(index) &&
      variable.kind === "ListVariable" &&
      variable.spec.plugin.kind === LABEL_VALUES_KIND &&
      sourceSpec(variable).labelName === ""
    ) {
      problems.set(index, "A label name is required.");
    }
  });
  return problems;
}

/** Drops empty optionals so the saved file stays canonical and minimal. */
function normalize(variable: Variable): Variable {
  const display =
    variable.spec.display?.name && variable.spec.display.name !== ""
      ? { name: variable.spec.display.name }
      : undefined;
  if (variable.kind === "TextVariable") {
    return {
      kind: "TextVariable",
      spec: {
        name: variable.spec.name,
        ...(display ? { display } : {}),
        value: variable.spec.value,
        ...(variable.spec.constant ? { constant: true } : {}),
      },
    };
  }
  const { labelName, matchers } = sourceSpec(variable);
  const matcherList = matchers
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const plugin =
    variable.spec.plugin.kind === LABEL_VALUES_KIND
      ? {
          kind: LABEL_VALUES_KIND,
          spec: {
            labelName,
            ...(matcherList.length > 0 ? { matchers: matcherList } : {}),
          },
        }
      : variable.spec.plugin;
  return {
    kind: "ListVariable",
    spec: {
      name: variable.spec.name,
      ...(display ? { display } : {}),
      ...(variable.spec.defaultValue !== undefined &&
      variable.spec.defaultValue !== ""
        ? { defaultValue: variable.spec.defaultValue }
        : {}),
      ...(variable.spec.allowAllValue ? { allowAllValue: true } : {}),
      ...(variable.spec.allowMultiple ? { allowMultiple: true } : {}),
      plugin,
    },
  };
}

function VariableRow({
  variable,
  problem,
  onChange,
  onRemove,
}: {
  variable: Variable;
  problem: string | undefined;
  onChange: (variable: Variable) => void;
  onRemove: () => void;
}) {
  const custom =
    variable.kind === "ListVariable" &&
    variable.spec.plugin.kind !== LABEL_VALUES_KIND;
  const source =
    variable.kind === "ListVariable" ? sourceSpec(variable) : null;

  const setSpec = (spec: Partial<Variable["spec"]>) =>
    onChange({
      ...variable,
      spec: { ...variable.spec, ...spec },
    } as Variable);
  const setSource = (updates: { labelName?: string; matchers?: string }) => {
    if (variable.kind !== "ListVariable" || custom) {
      return;
    }
    const current = sourceSpec(variable);
    const next = { ...current, ...updates };
    onChange({
      ...variable,
      spec: {
        ...variable.spec,
        plugin: {
          kind: LABEL_VALUES_KIND,
          // The working copy keeps the textarea's raw lines; save-time
          // normalization turns them into the matchers array.
          spec: { labelName: next.labelName, matchers: next.matchers },
        },
      },
    });
  };

  const switchKind = (kind: "ListVariable" | "TextVariable") => {
    if (kind === variable.kind) {
      return;
    }
    const shared = {
      name: variable.spec.name,
      ...(variable.spec.display ? { display: variable.spec.display } : {}),
    };
    onChange(
      kind === "TextVariable"
        ? ({ kind, spec: { ...shared, value: "" } } as TextVariable)
        : ({
            ...blankListVariable(variable.spec.name),
            spec: { ...blankListVariable(variable.spec.name).spec, ...shared },
          } as ListVariable),
    );
  };

  return (
    <Flex
      direction="column"
      gap={2}
      padding={3}
      borderWidth="1px"
      borderRadius="md"
    >
      <Flex gap={2} alignItems="flex-end" wrap="wrap">
        <Field.Root width="130px">
          <Field.Label>Type</Field.Label>
          <NativeSelect.Root size="xs" disabled={custom}>
            <NativeSelect.Field
              aria-label="Variable type"
              value={variable.kind}
              onChange={(event) =>
                switchKind(
                  event.target.value as "ListVariable" | "TextVariable",
                )
              }
            >
              <option value="ListVariable">Label values</option>
              <option value="TextVariable">Text</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>
        <Field.Root width="150px" invalid={problem !== undefined}>
          <Field.Label>Name</Field.Label>
          <Input
            size="xs"
            fontFamily="mono"
            aria-label="Variable name"
            value={variable.spec.name}
            onChange={(event) => setSpec({ name: event.target.value })}
          />
        </Field.Root>
        <Field.Root width="150px">
          <Field.Label>Label</Field.Label>
          <Input
            size="xs"
            aria-label="Variable label"
            placeholder={variable.spec.name}
            value={variable.spec.display?.name ?? ""}
            onChange={(event) =>
              setSpec({ display: { name: event.target.value } })
            }
          />
        </Field.Root>
        <Button
          size="xs"
          variant="ghost"
          colorPalette="red"
          marginLeft="auto"
          onClick={onRemove}
        >
          Remove
        </Button>
      </Flex>

      {variable.kind === "TextVariable" ? (
        <Flex gap={2} alignItems="flex-end" wrap="wrap">
          <Field.Root width="240px">
            <Field.Label>Value</Field.Label>
            <Input
              size="xs"
              aria-label="Variable value"
              value={variable.spec.value}
              onChange={(event) => setSpec({ value: event.target.value })}
            />
          </Field.Root>
          <Checkbox.Root
            size="sm"
            checked={variable.spec.constant ?? false}
            onCheckedChange={(event) =>
              setSpec({ constant: event.checked === true })
            }
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Constant (hidden from the toolbar)</Checkbox.Label>
          </Checkbox.Root>
        </Flex>
      ) : custom ? (
        <Text fontSize="xs" color="fg.muted">
          Source "{variable.spec.plugin.kind}" is not editable here — use
          the as-code editor.
        </Text>
      ) : (
        <Flex direction="column" gap={2}>
          <Flex gap={2} alignItems="flex-end" wrap="wrap">
            <Field.Root width="150px">
              <Field.Label>Label name</Field.Label>
              <Input
                size="xs"
                fontFamily="mono"
                aria-label="Prometheus label name"
                placeholder="instance"
                value={source?.labelName ?? ""}
                onChange={(event) =>
                  setSource({ labelName: event.target.value })
                }
              />
            </Field.Root>
            <Field.Root width="150px">
              <Field.Label>Default value</Field.Label>
              <Input
                size="xs"
                aria-label="Default value"
                value={
                  typeof variable.spec.defaultValue === "string"
                    ? variable.spec.defaultValue
                    : ""
                }
                onChange={(event) =>
                  setSpec({ defaultValue: event.target.value })
                }
              />
            </Field.Root>
            <Checkbox.Root
              size="sm"
              checked={variable.spec.allowAllValue ?? false}
              onCheckedChange={(event) =>
                setSpec({ allowAllValue: event.checked === true })
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Allow "All"</Checkbox.Label>
            </Checkbox.Root>
            <Checkbox.Root
              size="sm"
              checked={variable.spec.allowMultiple ?? false}
              onCheckedChange={(event) =>
                setSpec({ allowMultiple: event.checked === true })
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Allow multiple</Checkbox.Label>
            </Checkbox.Root>
          </Flex>
          <Field.Root>
            <Field.Label>Matchers (optional, one per line)</Field.Label>
            <Textarea
              size="xs"
              fontFamily="mono"
              rows={2}
              aria-label="Series matchers"
              placeholder={'up{job="node"}\nnode_uname_info{instance=~"$instance"}'}
              value={source?.matchers ?? ""}
              onChange={(event) => setSource({ matchers: event.target.value })}
            />
            <Field.HelperText>
              Series selectors narrowing the values; $other_variable
              references make this variable chained.
            </Field.HelperText>
          </Field.Root>
        </Flex>
      )}
      {problem ? (
        <Text fontSize="xs" color="fg.error">
          {problem}
        </Text>
      ) : null}
    </Flex>
  );
}

/**
 * Create/edit/remove dashboard variables from the form editor. Works on
 * a local copy and commits once on Save (a single undo step, and no
 * label-values reload on every keystroke).
 */
export function VariablesEditorDialog({
  variables,
  onSave,
  onClose,
}: {
  variables: Variable[];
  onSave: (variables: Variable[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<Variable[]>(variables);
  const problems = useMemo(() => validate(list), [list]);

  return (
    <Dialog.Root
      open
      size="lg"
      scrollBehavior="inside"
      onOpenChange={(event) => {
        if (!event.open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Variables</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={3}>
                {list.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    No variables yet. A variable becomes a toolbar selector
                    and is referenced in queries as $name.
                  </Text>
                ) : null}
                {list.map((variable, index) => (
                  <VariableRow
                    key={index}
                    variable={variable}
                    problem={problems.get(index)}
                    onChange={(next) =>
                      setList((current) =>
                        current.map((item, i) => (i === index ? next : item)),
                      )
                    }
                    onRemove={() =>
                      setList((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  />
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  alignSelf="flex-start"
                  onClick={() =>
                    setList((current) => [
                      ...current,
                      blankListVariable(uniqueName(current)),
                    ])
                  }
                >
                  Add variable
                </Button>
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                colorPalette="brand"
                disabled={problems.size > 0}
                onClick={() => {
                  onSave(list.map(normalize));
                  onClose();
                }}
              >
                Save variables
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
