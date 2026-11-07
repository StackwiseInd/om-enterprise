import { redirect } from "next/navigation";

/** /admin/delete-request: website accounts are the one kind of deletion request for now. */
export default function DeleteRequestIndex() {
  redirect("/admin/delete-request/online-orders");
}
