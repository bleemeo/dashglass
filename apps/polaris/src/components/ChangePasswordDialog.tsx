import { useState } from "react";

import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Input,
  Portal,
} from "@chakra-ui/react";

import { APIError, changePassword } from "../api/client";
import { toaster } from "./toaster";

/** Self-service password change for local users (UserMenu). */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm !== "" && next !== confirm;

  const submit = async () => {
    if (current === "" || next === "" || next !== confirm) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await changePassword(current, next);
      toaster.create({ title: "Password changed", type: "success" });
      onClose();
    } catch (changeError) {
      setError(
        changeError instanceof APIError
          ? changeError.message
          : String(changeError),
      );
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
              <Dialog.Title>Change password</Dialog.Title>
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
                <Field.Root>
                  <Field.Label>Current password</Field.Label>
                  <Input
                    size="sm"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    value={current}
                    onChange={(event) => setCurrent(event.target.value)}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>New password</Field.Label>
                  <Input
                    size="sm"
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(event) => setNext(event.target.value)}
                  />
                </Field.Root>
                <Field.Root invalid={mismatch}>
                  <Field.Label>Confirm new password</Field.Label>
                  <Input
                    size="sm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                  {mismatch ? (
                    <Field.ErrorText>Passwords do not match.</Field.ErrorText>
                  ) : null}
                </Field.Root>
                {error ? (
                  <Field.Root invalid>
                    <Field.ErrorText>{error}</Field.ErrorText>
                  </Field.Root>
                ) : null}
                {/* Hidden submit so Enter works inside the form. */}
                <button type="submit" hidden />
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
                disabled={current === "" || next === "" || next !== confirm}
                onClick={() => void submit()}
              >
                Change password
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
