import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { FilesWorkspaceClient } from "./_components/files-workspace-client";

export const metadata: Metadata = {
	description:
		"Manage private workspace files, folders, S3 presigned uploads, and pgvector RAG knowledge indexing.",
	title: "Files & Knowledge | Dashboard",
};

export default async function DashboardFilesPage() {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/dashboard/files");
	}

	return (
		<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
			<FilesWorkspaceClient />
		</div>
	);
}
