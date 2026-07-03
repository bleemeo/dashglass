import {
  Button,
  CloseButton,
  Dialog,
  Portal,
  Text,
} from "@chakra-ui/react";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Chakra color palette of the confirm button (default red). */
  colorPalette?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Small confirmation modal replacing window.confirm. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  colorPalette = "red",
  loading,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open
      size="sm"
      role="alertdialog"
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
              <Text fontSize="sm">{message}</Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                colorPalette={colorPalette}
                loading={loading ?? false}
                onClick={onConfirm}
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
