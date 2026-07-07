import { useState } from "react";

import { Badge, Box, Button, Menu, Portal, Text } from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { logout, logoutEverywhere } from "../api/client";
import { usePermissions } from "../api/hooks";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 15l6-6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Signed-in identity in the sidebar. The account actions (change
 * password, sign out) live in a dropdown behind the identity, rather
 * than as always-visible buttons.
 */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Passwords are local-store only: proxy/OIDC identities manage theirs
  // at the provider.
  const { username, role, authKind } = usePermissions();
  const [changingPassword, setChangingPassword] = useState(false);

  const signOut = async () => {
    await logout();
    await queryClient.invalidateQueries();
    void navigate("/login");
  };

  const signOutEverywhere = async () => {
    await logoutEverywhere();
    await queryClient.invalidateQueries();
    void navigate("/login");
  };

  const trigger = collapsed ? (
    <Button
      variant="ghost"
      size="sm"
      color="fg.muted"
      paddingX={0}
      aria-label={`Account: ${username ?? ""}`}
      title={`${username ?? ""}${role ? ` (${role})` : ""}`}
    >
      <AccountIcon />
    </Button>
  ) : (
    <Button
      variant="ghost"
      width="full"
      justifyContent="flex-start"
      gap={2}
      height="auto"
      paddingX={2}
      paddingY={1.5}
      fontWeight="normal"
    >
      <Box color="fg.muted" flexShrink={0}>
        <AccountIcon />
      </Box>
      <Text fontSize="sm" fontWeight="medium" truncate flex={1} textAlign="left">
        {username}
      </Text>
      {role ? (
        <Badge size="xs" variant="subtle" flexShrink={0}>
          {role}
        </Badge>
      ) : null}
      <Box color="fg.muted" flexShrink={0}>
        <ChevronIcon />
      </Box>
    </Button>
  );

  return (
    <Box marginBottom={2}>
      <Menu.Root
        positioning={{
          // Bottom-anchored in the sidebar: open upward (or to the side
          // of the collapsed rail).
          placement: collapsed ? "right-end" : "top-start",
        }}
      >
        <Menu.Trigger asChild>{trigger}</Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content minWidth="180px">
              {collapsed ? (
                <>
                  <Box paddingX={3} paddingY={2}>
                    <Text fontSize="sm" fontWeight="medium" truncate>
                      {username}
                    </Text>
                    {role ? (
                      <Text fontSize="xs" color="fg.muted">
                        {role}
                      </Text>
                    ) : null}
                  </Box>
                  <Menu.Separator />
                </>
              ) : null}
              {authKind === "builtin" ? (
                <Menu.Item
                  value="change-password"
                  onClick={() => setChangingPassword(true)}
                >
                  Change password
                </Menu.Item>
              ) : null}
              <Menu.Item value="sign-out" onClick={() => void signOut()}>
                Sign out
              </Menu.Item>
              {authKind === "builtin" ? (
                <Menu.Item
                  value="sign-out-all"
                  color="fg.error"
                  _hover={{ backgroundColor: "bg.error" }}
                  onClick={() => void signOutEverywhere()}
                >
                  Sign out everywhere
                </Menu.Item>
              ) : null}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
      {changingPassword ? (
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      ) : null}
    </Box>
  );
}
