/*
 * El kit de interfaz de Pasarelas. Todo se importa desde aquí: `import { Button, Field } from "@/components/ui"`.
 * Cada componente se ve, con sus props, en la galería `/kit` (solo en desarrollo).
 * Los colores, radios y sombras son los tokens de `src/app/globals.css`.
 */
export { Alert, type AlertProps, type AlertTone } from "./Alert";
export { Badge, type BadgeProps, type BadgeTone } from "./Badge";
export {
  Button,
  ButtonLink,
  IconButton,
  type ButtonLinkProps,
  type ButtonProps,
  type ButtonVariant,
  type IconButtonProps,
} from "./Button";
export { Card, CardBody, CardHeader, CardTitle, type CardTitleProps } from "./Card";
export { cn } from "./cn";
export { ConfirmDialog, Dialog, type ConfirmDialogProps, type DialogProps } from "./Dialog";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { Field, type FieldProps } from "./Field";
export {
  DateText,
  DateTimeText,
  Money,
  Percent,
  type DateTextProps,
  type DateTimeTextProps,
  type MoneyProps,
  type PercentProps,
} from "./Figures";
export {
  Input,
  MoneyInput,
  PctInput,
  Select,
  Textarea,
  type InputProps,
  type MoneyInputProps,
  type PctInputProps,
  type SelectProps,
  type TextareaProps,
} from "./Inputs";
export { notify } from "./notify";
export { BackLink, PageHeader, type BackLinkProps, type PageHeaderProps } from "./PageHeader";
export { Pagination, type PaginationProps } from "./Pagination";
export { Skeleton } from "./Skeleton";
export { Stat, type StatProps } from "./Stat";
export { SubmitButton, type SubmitButtonProps } from "./SubmitButton";
export { Table, TBody, Td, Th, THead, Tr, type TableProps, type TdProps, type ThProps, type TrProps } from "./Table";
export { TabsNav, type TabsNavProps } from "./TabsNav";
export { Toaster } from "./Toaster";
export { Checkbox, Switch, type CheckboxProps, type SwitchProps } from "./Toggles";
export { UrlPeriod, UrlSearch, UrlSelect, type UrlPeriodProps, type UrlSearchProps, type UrlSelectProps } from "./UrlFilters";
