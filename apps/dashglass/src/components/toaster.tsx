"use client";

import {
  Toaster as ChakraToaster,
  Portal,
  Spinner,
  Stack,
  Toast,
  createToaster,
} from "@chakra-ui/react";

const toastStore = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
});

type ToastOptions = Parameters<typeof toastStore.create>[0];

/**
 * App-wide toast queue: `toaster.create({ title, type, action })`. Every
 * toast is dismissible, and errors stay until dismissed — they must
 * survive long enough to be read (and copied).
 */
export const toaster = {
  create: (options: ToastOptions) =>
    toastStore.create({
      closable: true,
      ...(options.type === "error"
        ? { duration: Number.POSITIVE_INFINITY }
        : {}),
      ...options,
    }),
};

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toastStore} insetInline={{ mdDown: "4" }}>
        {(toast) => (
          <Toast.Root width={{ md: "sm" }}>
            {toast.type === "loading" ? (
              <Spinner size="sm" color="blue.solid" />
            ) : (
              <Toast.Indicator />
            )}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title ? <Toast.Title>{toast.title}</Toast.Title> : null}
              {toast.description ? (
                <Toast.Description>{toast.description}</Toast.Description>
              ) : null}
            </Stack>
            {toast.action ? (
              <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>
            ) : null}
            {toast.closable ? <Toast.CloseTrigger /> : null}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
