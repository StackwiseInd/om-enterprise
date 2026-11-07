import { redirect } from "next/navigation";

/** /admin/logs: the online orders log is the one log here for now. */
export default function LogsIndex() {
  redirect("/admin/logs/online-orders");
}
