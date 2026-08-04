import { useState } from "react";

import {
  Badge,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Table,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  APIError,
  adminConfig,
  adminCreateUser,
  adminDeleteUser,
  adminGetDatasource,
  adminGetGit,
  adminListUsers,
  adminPutDatasource,
  adminPutGit,
  adminSyncGit,
  adminTestDatasource,
  adminTestGit,
  adminUpdateUser,
  type AdminDatasource,
  type AdminGit,
  type DatasourceInput,
  type Role,
} from "../api/client";
import { usePermissions } from "../api/hooks";
import { relativeTime } from "../lib/relativeTime";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TopBar } from "../components/TopBar";
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
              <Button
                size="sm"
                colorPalette="brand"
                loading={pending}
                onClick={() => void submit()}
              >
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

function ExternalUsersNote({ kind }: { kind: string }) {
  return (
    <Flex
      direction="column"
      gap={1}
      padding={3}
      borderWidth="1px"
      borderRadius="md"
    >
      <Text fontSize="sm" fontWeight="medium">
        {kind === "oidc"
          ? "Authentication is handled by OpenID Connect"
          : "Authentication is handled by a reverse proxy"}
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
  const {
    authEnabled,
    externalIdentity,
    authKind,
    username: currentUser,
  } = usePermissions();
  // Proxy mode has no local accounts; skip the users query entirely.
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: adminListUsers,
    enabled: !externalIdentity,
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

  if (externalIdentity) {
    return <ExternalUsersNote kind={authKind} />;
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
        <Button size="sm" colorPalette="brand" onClick={() => setCreating(true)}>
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
    // Set at runtime from the admin UI (datasource tab).
    admin: "green",
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
            Group → role mapping
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Identity-provider groups mapped to roles (highest match wins,
            “*” = any authenticated user). Edit dashglass.yaml to change it.
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

/** Editable Prometheus connection; locked when provisioned by the
 * deployment (flag/env/file), per the same philosophy as -readonly. */
/** "Name: value" lines ↔ header map (the form's textarea encoding). */
function formatHeaders(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) {
      continue;
    }
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (name && value) {
      headers[name] = value;
    }
  }
  return headers;
}

function DatasourceForm({ view }: { view: AdminDatasource }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(view.url ?? "");
  const [auth, setAuth] = useState<DatasourceInput["auth"]>(view.auth ?? "none");
  const [username, setUsername] = useState(view.username ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [headersText, setHeadersText] = useState(formatHeaders(view.headers));
  const [caCert, setCaCert] = useState(view.caCert ?? "");
  const [clientCert, setClientCert] = useState(view.clientCert ?? "");
  const [clientKey, setClientKey] = useState("");
  const [skipVerify, setSkipVerify] = useState(view.insecureSkipVerify ?? false);
  const [test, setTest] = useState<{ reachable: boolean; error?: string } | null>(
    null,
  );

  const input = (): DatasourceInput => ({
    url: url.trim(),
    auth,
    ...(auth === "basic" ? { username, password } : {}),
    ...(auth === "bearer" ? { token } : {}),
    headers: parseHeaders(headersText),
    caCert: caCert.trim(),
    clientCert: clientCert.trim(),
    // Never send a key without its cert: the state can be stale after
    // the (conditionally rendered) key field unmounts.
    clientKey: clientCert.trim() === "" ? "" : clientKey,
    insecureSkipVerify: skipVerify,
  });

  const testConnection = useMutation({
    mutationFn: () => adminTestDatasource(input()),
    onSuccess: setTest,
    onError: (error) =>
      setTest({ reachable: false, error: errorText(error) }),
  });
  const save = useMutation({
    mutationFn: () => adminPutDatasource(input()),
    onSuccess: () => {
      // The capability flag, health banner and config view all reflect
      // the connection: refresh them along with the datasource itself.
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["capabilities"] });
      void queryClient.invalidateQueries({ queryKey: ["prometheus"] });
      toaster.create({ type: "success", description: "Datasource saved." });
    },
    onError: (error) =>
      toaster.create({
        type: "error",
        description: errorText(error),
        closable: true,
      }),
  });

  // A secret already stored for the current mode can be left untouched.
  const secretPlaceholder =
    view.configured && view.auth === auth ? "(unchanged)" : "";

  return (
    <Flex direction="column" gap={4} maxWidth="480px">
      <Text fontSize="sm" color="fg.muted">
        The Prometheus this instance queries. Credentials are stored
        server-side and never sent to browsers.
      </Text>
      <Field.Root>
        <Field.Label>Prometheus URL</Field.Label>
        <Input
          size="sm"
          placeholder="http://prometheus:9090"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Authentication</Field.Label>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={auth}
            onChange={(event) =>
              setAuth(event.target.value as DatasourceInput["auth"])
            }
          >
            <option value="none">None</option>
            <option value="basic">Basic auth</option>
            <option value="bearer">Bearer token</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
      {auth === "basic" ? (
        <>
          <Field.Root>
            <Field.Label>Username</Field.Label>
            <Input
              size="sm"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Password</Field.Label>
            <Input
              size="sm"
              type="password"
              placeholder={secretPlaceholder}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field.Root>
        </>
      ) : null}
      {auth === "bearer" ? (
        <Field.Root>
          <Field.Label>Token</Field.Label>
          <Input
            size="sm"
            type="password"
            placeholder={secretPlaceholder}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </Field.Root>
      ) : null}
      <Text fontSize="sm" fontWeight="medium" marginTop={2}>
        Advanced — headers & TLS
      </Text>
      <Field.Root>
        <Field.Label>Extra headers</Field.Label>
        <Textarea
          size="sm"
          rows={2}
          fontFamily="mono"
          placeholder={"X-Scope-OrgID: tenant-1"}
          value={headersText}
          onChange={(event) => setHeadersText(event.target.value)}
        />
        <Field.HelperText>
          One "Name: value" per line, sent with every Prometheus request
          (Mimir/Cortex tenancy, custom auth schemes…). An Authorization
          value is a credential: it shows as "(secret)" once saved; leave
          that as-is to keep it.
        </Field.HelperText>
      </Field.Root>
      <Field.Root>
        <Field.Label>CA certificate (PEM)</Field.Label>
        <Textarea
          size="sm"
          rows={3}
          fontFamily="mono"
          placeholder="-----BEGIN CERTIFICATE-----"
          value={caCert}
          onChange={(event) => setCaCert(event.target.value)}
        />
        <Field.HelperText>
          Replaces the system trust store for this connection — for
          self-signed or private-CA Prometheus endpoints.
        </Field.HelperText>
      </Field.Root>
      <Field.Root>
        <Field.Label>Client certificate (PEM, mTLS)</Field.Label>
        <Textarea
          size="sm"
          rows={3}
          fontFamily="mono"
          placeholder="-----BEGIN CERTIFICATE-----"
          value={clientCert}
          onChange={(event) => {
            setClientCert(event.target.value);
            // The key belongs to the cert: clearing the cert discards
            // any pasted key, so a stale key can never be submitted.
            if (event.target.value.trim() === "") {
              setClientKey("");
            }
          }}
        />
      </Field.Root>
      {clientCert.trim() !== "" ? (
        <Field.Root>
          <Field.Label>Client key (PEM)</Field.Label>
          <Textarea
            size="sm"
            rows={3}
            fontFamily="mono"
            placeholder={
              view.clientKeySet &&
              clientCert.trim() === (view.clientCert ?? "").trim()
                ? "(unchanged)"
                : "-----BEGIN PRIVATE KEY-----"
            }
            value={clientKey}
            onChange={(event) => setClientKey(event.target.value)}
          />
          <Field.HelperText>
            Stored server-side, never shown again.
          </Field.HelperText>
        </Field.Root>
      ) : null}
      <Checkbox.Root
        size="sm"
        checked={skipVerify}
        onCheckedChange={(details) => setSkipVerify(details.checked === true)}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label>
          Skip TLS certificate verification (insecure — prefer a CA
          certificate)
        </Checkbox.Label>
      </Checkbox.Root>
      <Flex gap={2} alignItems="center">
        <Button
          size="sm"
          variant="outline"
          disabled={url.trim() === ""}
          loading={testConnection.isPending}
          onClick={() => testConnection.mutate()}
        >
          Test connection
        </Button>
        <Button
          size="sm"
          colorPalette="brand"
          disabled={url.trim() === ""}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </Flex>
      {test ? (
        <Text
          fontSize="sm"
          color={test.reachable ? "green.fg" : "fg.error"}
          role="status"
        >
          {test.reachable
            ? "Connection OK — Prometheus answered."
            : (test.error ?? "Unreachable.")}
        </Text>
      ) : null}
    </Flex>
  );
}

function DatasourceTab() {
  const datasource = useQuery({
    queryKey: ["admin", "datasource"],
    queryFn: adminGetDatasource,
  });

  if (datasource.isPending) {
    return null;
  }
  if (datasource.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        {errorText(datasource.error)}
      </Text>
    );
  }
  const view = datasource.data;
  if (!view.editable) {
    return (
      <Flex direction="column" gap={2} maxWidth="480px">
        <Text fontSize="sm" color="fg.muted">
          The Prometheus URL is provisioned by the deployment (flag,
          environment or dashglass.yaml) and can only be changed there.
        </Text>
        <Text fontSize="sm" fontFamily="mono">
          {view.url ?? "—"}
        </Text>
      </Flex>
    );
  }
  // Remount the form when the server view changes so edits start fresh.
  return <DatasourceForm key={JSON.stringify(view)} view={view} />;
}

/** Sync-loop status lines (branch, ahead/behind, last sync, error). */
function GitSyncStatusView({ view }: { view: AdminGit }) {
  const status = view.status;
  if (!view.enabled || !status) {
    return null;
  }
  return (
    <Flex direction="column" gap={1} fontSize="sm">
      <Text color="fg.muted">
        Branch <Text as="span" fontFamily="mono">{status.branch ?? "—"}</Text>
        {" · "}
        {status.ahead > 0 ? `${status.ahead} to push` : null}
        {status.ahead > 0 && status.behind > 0 ? " · " : null}
        {status.behind > 0 ? `${status.behind} to pull` : null}
        {status.ahead === 0 && status.behind === 0 ? "in sync" : null}
        {status.lastSync
          ? ` · last sync ${relativeTime(status.lastSync)}`
          : " · never synced"}
      </Text>
      {status.lastError ? (
        <Text color="fg.error">{status.lastError}</Text>
      ) : null}
    </Flex>
  );
}

/** Matches git's scp-like remote syntax (git@github.com:acme/x). */
function isSSHRemote(url: string): boolean {
  return url.startsWith("ssh://") || /^(?:[\w.-]+@)?[\w.-]+:[^/]/.test(url);
}

/** Editable git sync remote; locked when provisioned in dashglass.yaml. */
function GitForm({ view }: { view: AdminGit }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(view.url ?? "");
  const [username, setUsername] = useState(view.username ?? "");
  const [token, setToken] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [interval, setIntervalSeconds] = useState(
    String(view.intervalSeconds ?? 60),
  );
  const [test, setTest] = useState<{ reachable: boolean; error?: string } | null>(
    null,
  );
  const ssh = isSSHRemote(url.trim());

  const input = () => ({
    url: url.trim(),
    ...(ssh ? { sshKey } : { username, token }),
    intervalSeconds: Number(interval) || 0,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "git"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
  };

  const testConnection = useMutation({
    mutationFn: () => adminTestGit(input()),
    onSuccess: setTest,
    onError: (error) => setTest({ reachable: false, error: errorText(error) }),
  });
  const save = useMutation({
    mutationFn: () => adminPutGit(input()),
    onSuccess: () => {
      invalidate();
      toaster.create({
        type: "success",
        description:
          url.trim() === "" ? "Git sync disabled." : "Git sync configured.",
      });
    },
    onError: (error) =>
      toaster.create({
        type: "error",
        description: errorText(error),
        closable: true,
      }),
  });
  const syncNow = useMutation({
    mutationFn: adminSyncGit,
    onSuccess: (status) => {
      invalidate();
      toaster.create({
        type: status.lastError ? "error" : "success",
        description: status.lastError ?? "Synced with the remote.",
        closable: Boolean(status.lastError),
      });
    },
  });

  return (
    <Flex direction="column" gap={4} maxWidth="480px">
      <Text fontSize="sm" color="fg.muted">
        Push dashboard commits to a git remote and pull external changes.
        HTTPS (username + token) and SSH (deploy key) are supported;
        credentials are stored server-side and never sent to browsers.
      </Text>
      {view.enabled && !view.commitOnSave ? (
        <Text fontSize="sm" color="fg.muted">
          Note: git.commit_on_save is off, so UI edits are not committed —
          only manual commits get pushed.
        </Text>
      ) : null}
      <Field.Root>
        <Field.Label>Remote URL</Field.Label>
        <Input
          size="sm"
          placeholder="https://github.com/acme/dashboards.git or git@github.com:acme/dashboards.git"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field.Root>
      {ssh ? (
        <Field.Root>
          <Field.Label>SSH private key</Field.Label>
          <Textarea
            size="sm"
            fontFamily="mono"
            fontSize="xs"
            rows={6}
            placeholder={
              view.enabled && view.auth === "ssh"
                ? "(unchanged)"
                : "-----BEGIN OPENSSH PRIVATE KEY-----"
            }
            value={sshKey}
            onChange={(event) => setSshKey(event.target.value)}
          />
          <Field.HelperText>
            An unencrypted deploy key with read/write access. The host key
            is pinned on first use.
          </Field.HelperText>
        </Field.Root>
      ) : (
        <>
          <Field.Root>
            <Field.Label>Username</Field.Label>
            <Input
              size="sm"
              placeholder="x-access-token, oauth2, a bot account…"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Token</Field.Label>
            <Input
              size="sm"
              type="password"
              placeholder={
                view.enabled && view.auth !== "ssh" ? "(unchanged)" : ""
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field.Root>
        </>
      )}
      <Field.Root>
        <Field.Label>Pull interval (seconds)</Field.Label>
        <Input
          size="sm"
          type="number"
          min={10}
          value={interval}
          onChange={(event) => setIntervalSeconds(event.target.value)}
        />
      </Field.Root>
      <Flex gap={2} alignItems="center">
        <Button
          size="sm"
          variant="outline"
          disabled={url.trim() === ""}
          loading={testConnection.isPending}
          onClick={() => testConnection.mutate()}
        >
          Test connection
        </Button>
        <Button
          size="sm"
          colorPalette="brand"
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        {view.enabled ? (
          <Button
            size="sm"
            variant="ghost"
            loading={syncNow.isPending}
            onClick={() => syncNow.mutate()}
          >
            Sync now
          </Button>
        ) : null}
      </Flex>
      {test ? (
        <Text
          fontSize="sm"
          color={test.reachable ? "green.fg" : "fg.error"}
          role="status"
        >
          {test.reachable
            ? "Connection OK — the remote answered."
            : (test.error ?? "Unreachable.")}
        </Text>
      ) : null}
      <GitSyncStatusView view={view} />
    </Flex>
  );
}

function GitTab() {
  const git = useQuery({
    queryKey: ["admin", "git"],
    queryFn: adminGetGit,
    // The sync loop runs in the background: keep the status fresh.
    refetchInterval: 15_000,
  });

  if (git.isPending) {
    return null;
  }
  if (git.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        {errorText(git.error)}
      </Text>
    );
  }
  const view = git.data;
  if (!view.gitAvailable) {
    return (
      <Text fontSize="sm" color="fg.muted" maxWidth="480px">
        Git sync needs the dashboards directory to be inside a git work
        tree (git init it, or point -dashboards-dir at a clone).
      </Text>
    );
  }
  if (!view.editable) {
    return (
      <Flex direction="column" gap={2} maxWidth="480px">
        <Text fontSize="sm" color="fg.muted">
          The git remote is provisioned in dashglass.yaml and can only be
          changed there.
        </Text>
        <Text fontSize="sm" fontFamily="mono">
          {view.url ?? "—"}
        </Text>
        <GitSyncStatusView view={view} />
      </Flex>
    );
  }
  return <GitForm key={JSON.stringify(view)} view={view} />;
}

/** The admin surface: local users and the effective configuration. */
export function AdminPage() {
  usePageTitle("Admin");
  return (
    <Flex direction="column" gap={4}>
      <TopBar crumbs={[{ label: "Admin" }]} />
      <Tabs.Root defaultValue="users" size="sm">
        <Tabs.List marginBottom={4}>
          <Tabs.Trigger value="users">Users</Tabs.Trigger>
          <Tabs.Trigger value="datasource">Datasource</Tabs.Trigger>
          <Tabs.Trigger value="git">Git sync</Tabs.Trigger>
          <Tabs.Trigger value="config">Configuration</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="users">
          <UsersTab />
        </Tabs.Content>
        <Tabs.Content value="datasource">
          <DatasourceTab />
        </Tabs.Content>
        <Tabs.Content value="git">
          <GitTab />
        </Tabs.Content>
        <Tabs.Content value="config">
          <ConfigTab />
        </Tabs.Content>
      </Tabs.Root>
    </Flex>
  );
}
