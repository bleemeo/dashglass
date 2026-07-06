import { Flex, Input, NativeSelect, Text } from "@chakra-ui/react";

import { useVariables } from "@polarisui/runtime";
import type { Variable } from "@polarisui/model";

export interface VariablesToolbarProps {
  variables: Variable[];
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
        return (
          <Flex key={name} gap={1.5} alignItems="center">
            <Text fontSize="sm" color="fg.muted">
              {label}
            </Text>
            {variable.kind === "ListVariable" ? (
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
