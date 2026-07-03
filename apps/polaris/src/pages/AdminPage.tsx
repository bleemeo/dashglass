import { useState } from "react";

import {
  Badge,
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Heading,
  Input,
  NativeSelect,
  Portal,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  APIError,
  adminConfig,
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminUpdateUser,
  type Role,
} from "../api/client";
import { usePermissions } from "../api/hooks";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlusIcon } from "../components/icons";
import { toaster } from "../components/toaster";
import { usePageTitle } from "../hooks/usePageTitle";

const ROLES: Role[] = ["viewer", "editor", "admin"];

function errorText(error: unknown): string {
  return error instanceof APIError ? error.message : String(error);
}

function UserDialog({
  title,
  confirmLabel,
  withUsername,
  withRole,
  onSubmit,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  withUsername?: boolean;
  withRole?: boolean;
  onSubmit: (values: {
    username: string;
    password: string;
    role: Role;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onSubmit({ username, password, role });
      onClose();
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root
      open
      size="sm"
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
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex
                as="form"
                direction="column"
                gap={3}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                {withUsername ? (
                  <Field.Root>
                    <Field.Label>Username</Field.Label>
                    <Input
                      size="sm"
                      autoFocus
                      autoComplete="off"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </Field.Root>
                ) : null}
                <Field.Root>
                  <Field.Label>Password</Field.Label>
                  <Input
                    size="sm"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Field.HelperText>At least 8 characters.</Field.HelperText>
                </Field.Root>
                {withRole ? (
                  <Field.Root>
                    <Field.Label>Role</Field.Label>
                    <NativeSelect.Root size="sm">
                      <NativeSelect.Field
                        value={role}
                        onChange={(event) =>
                          setRole(event.target.value as Role)
                        }
                      >
                        {ROLES.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>
                ) : null}
                {error ? (
                  <Text fontSize="sm" color="fg.error">
                    {error}
                  </Text>
                ) : null}
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" loading={pending} onClick={() => void submit()}>
                {confirmLabel}
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

function ProxyUsersNote() {
  return (
    <Flex
      direction="column"
      gap={1}
      padding={3}
      borderWidth="1px"
      borderRadius="md"
    >
      <Text fontSize="sm" fontWeight="medium">
        Authentication is handled by a reverse proxy
      </Text>
      <Text fontSize="sm" color="fg.muted">
        Users and their groups come from your identity provider; roles are
        assigned by the group mapping (see the Configuration tab). There
        are no local accounts to manage here.
      </Text>
    </Flex>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const { authEnabled, proxy, username: currentUser } = usePermissions();
  // Proxy mode has no local accounts; skip the users query entirely.
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: adminListUsers,
    enabled: !proxy,
  });
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
      queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
    ]);

  const changeRole = useMutation({
    mutationFn: ({ username, role }: { username: string; role: Role }) =>
      adminUpdateUser(username, { role }),
    onSuccess: () => void invalidate(),
    onError: (error) =>
      toaster.create({ title: errorText(error), type: "error" }),
  });
  const remove = useMutation({
    mutationFn: adminDeleteUser,
    onSuccess: () => void invalidate(),
    onError: (error) =>
      toaster.create({ title: errorText(error), type: "error" }),
    onSettled: () => setDeleting(null),
  });

  if (proxy) {
    return <ProxyUsersNote />;
  }

  return (
    <Flex direction="column" gap={4}>
      {authEnabled ? null : (
        <Flex
          direction="column"
          gap={1}
          padding={3}
          borderWidth="1px"
          borderRadius="md"
          borderColor="orange.400"
        >
          <Text fontSize="sm" fontWeight="medium">
            Authentication is disabled
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Anyone reaching this instance has full access. Creating the
            first user (an admin) enables authentication — you will then be
            asked to sign in.
          </Text>
        </Flex>
      )}
      <Flex justifyContent="space-between" alignItems="center">
        <Text fontSize="sm" color="fg.muted">
          {users.data?.length ?? 0} local user(s)
        </Text>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> {authEnabled ? "Add user" : "Create the first user"}
        </Button>
      </Flex>

      {users.data?.length ? (
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Username</Table.ColumnHeader>
              <Table.ColumnHeader>Role</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="right"></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {users.data.map((user) => (
              <Table.Row key={user.username}>
                <Table.Cell fontWeight="medium">
                  {user.username}
                  {user.username === currentUser ? (
                    <Badge marginLeft={2}>you</Badge>
                  ) : null}
                </Table.Cell>
                <Table.Cell>
                  <NativeSelect.Root size="xs" width="auto">
                    <NativeSelect.Field
                      value={user.role}
                      onChange={(event) =>
                        changeRole.mutate({
                          username: user.username,
                          role: event.target.value as Role,
                        })
                      }
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setResetting(user.username)}
                  >
                    Reset password
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    onClick={() => setDeleting(user.username)}
                  >
                    Delete
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      ) : null}

      {creating ? (
        <UserDialog
          title={authEnabled ? "Add user" : "Create the first user (admin)"}
          confirmLabel="Create"
          withUsername
          withRole={authEnabled}
          onSubmit={async ({ username, password, role }) => {
            await adminCreateUser(
              username,
              password,
              authEnabled ? role : "admin",
            );
            toaster.create({
              title: authEnabled
                ? `User "${username}" created`
                : "Authentication enabled — please sign in",
              type: "success",
            });
            await invalidate();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {resetting ? (
        <UserDialog
          title={`Reset password for "${resetting}"`}
          confirmLabel="Reset"
          onSubmit={async ({ password }) => {
            await adminUpdateUser(resetting, { password });
            toaster.create({ title: "Password updated", type: "success" });
          }}
          onClose={() => setResetting(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete user"
          message={`"${deleting}" will no longer be able to sign in.`}
          loading={remove.isPending}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Flex>
  );
}

function ConfigTab() {
  const config = useQuery({ queryKey: ["admin", "config"], queryFn: adminConfig });
  const sourceColor: Record<string, string> = {
    default: "gray",
    file: "blue",
    env: "purple",
    flag: "orange",
  };
  const mapping = config.data?.roleMapping;

  return (
    <Flex direction="column" gap={5}>
      <Flex direction="column" gap={3}>
        <Text fontSize="sm" color="fg.muted">
          Effective configuration and where each value comes from
          (flags &gt; environment &gt; file &gt; defaults).
        </Text>
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Setting</Table.ColumnHeader>
              <Table.ColumnHeader>Value</Table.ColumnHeader>
              <Table.ColumnHeader>Source</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(config.data?.settings ?? []).map((setting) => (
              <Table.Row key={setting.key}>
                <Table.Cell fontFamily="mono" fontSize="xs">
                  {setting.key}
                </Table.Cell>
                <Table.Cell fontFamily="mono" fontSize="xs" wordBreak="break-all">
                  {setting.value === "" ? "—" : setting.value}
                </Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={sourceColor[setting.source] ?? "gray"}>
                    {setting.source}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Flex>

      {mapping ? (
        <Flex direction="column" gap={2}>
          <Text fontSize="sm" fontWeight="medium">
            Reverse-proxy role mapping
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Identity-provider groups mapped to roles (highest match wins,
            “*” = any authenticated user). Edit polaris.yaml to change it.
          </Text>
          <Table.Root size="sm">
            <Table.Body>
              {(["admin", "editor", "viewer"] as const).map((role) => (
                <Table.Row key={role}>
                  <Table.Cell width="120px">
                    <Badge>{role}</Badge>
                  </Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs">
                    {(mapping[role] ?? []).join(", ") || "—"}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Flex>
      ) : null}
    </Flex>
  );
}

/** The admin surface: local users and the effective configuration. */
export function AdminPage() {
  usePageTitle("Admin");
  return (
    <Flex direction="column" gap={4}>
      <Heading size="lg">Admin</Heading>
      <Tabs.Root defaultValue="users" size="sm">
        <Tabs.List marginBottom={4}>
          <Tabs.Trigger value="users">Users</Tabs.Trigger>
          <Tabs.Trigger value="config">Configuration</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="users">
          <UsersTab />
        </Tabs.Content>
        <Tabs.Content value="config">
          <ConfigTab />
        </Tabs.Content>
      </Tabs.Root>
    </Flex>
  );
}
