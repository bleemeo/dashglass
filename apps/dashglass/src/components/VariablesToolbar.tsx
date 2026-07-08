import {
  Button,
  Flex,
  Input,
  Menu,
  NativeSelect,
  Portal,
  Text,
} from "@chakra-ui/react";

import { useVariables } from "@dashglass/runtime";
import type { Variable } from "@dashglass/model";

export interface VariablesToolbarProps {
  variables: Variable[];
}

/** Checkbox dropdown for a multi-select (allowMultiple) list variable. */
function MultiSelect({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | string[] | undefined;
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const chosen = new Set(selected);
  const summary =
    selected.length === 0
      ? "None"
      : selected.length === options.length && options.length > 0
        ? "All"
        : selected.length === 1
          ? selected[0]
          : `${selected.length} selected`;

  const toggle = (option: string) => {
    const next = new Set(chosen);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }
    // Preserve the option order for a stable, readable matcher.
    onChange(options.filter((o) => next.has(o)));
  };

  return (
    <Menu.Root closeOnSelect={false} positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          fontWeight="normal"
          disabled={disabled}
          aria-label={label}
          maxWidth="200px"
        >
          <Text as="span" truncate>
            {summary}
          </Text>
          <Text as="span" color="fg.muted">
            ▾
          </Text>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content maxHeight="320px" overflowY="auto" minWidth="180px">
            <Menu.Item value="__all" onClick={() => onChange(options)}>
              Select all
            </Menu.Item>
            <Menu.Item value="__none" onClick={() => onChange([])}>
              Clear
            </Menu.Item>
            <Menu.Separator />
            {options.map((option) => (
              <Menu.CheckboxItem
                key={option}
                value={option}
                checked={chosen.has(option)}
                onCheckedChange={() => toggle(option)}
              >
                <Menu.ItemIndicator />
                {option}
              </Menu.CheckboxItem>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

/** Selectors for dashboard variables; renders nothing without any. */
export function VariablesToolbar({ variables }: VariablesToolbarProps) {
  const { values, options, setValue, loading, errors } = useVariables();

  const editable = variables.filter(
    (variable) =>
      variable.kind === "ListVariable" ||
      (variable.kind === "TextVariable" && !variable.spec.constant),
  );
  if (editable.length === 0) {
    return null;
  }

  return (
    <Flex gap={3} alignItems="center" wrap="wrap">
      {editable.map((variable) => {
        const name = variable.spec.name;
        const label = variable.spec.display?.name ?? name;
        const value = values[name];
        const multiple =
          variable.kind === "ListVariable" && variable.spec.allowMultiple;
        return (
          <Flex key={name} gap={1.5} alignItems="center">
            <Text fontSize="sm" color="fg.muted">
              {label}
            </Text>
            {variable.kind === "ListVariable" && multiple ? (
              <MultiSelect
                label={label}
                options={options[name] ?? []}
                value={value}
                disabled={loading}
                onChange={(next) => setValue(name, next)}
              />
            ) : variable.kind === "ListVariable" ? (
              <NativeSelect.Root
                size="xs"
                width="auto"
                disabled={loading}
                aria-busy={loading}
              >
                <NativeSelect.Field
                  aria-label={label}
                  value={Array.isArray(value) ? value[0] : (value ?? "")}
                  onChange={(event) => setValue(name, event.target.value)}
                >
                  {variable.spec.allowAllValue ? (
                    <option value=".+">All</option>
                  ) : null}
                  {(options[name] ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            ) : (
              <Input
                size="xs"
                width="130px"
                aria-label={label}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => setValue(name, event.target.value)}
              />
            )}
            {errors[name] ? (
              <Text
                fontSize="sm"
                color="fg.error"
                cursor="help"
                role="img"
                aria-label={`Failed to load values for ${label}`}
                title={`Failed to load values: ${errors[name]}`}
              >
                ⚠
              </Text>
            ) : null}
          </Flex>
        );
      })}
    </Flex>
  );
}
