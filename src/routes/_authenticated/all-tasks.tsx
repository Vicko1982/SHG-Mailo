import { createFileRoute } from "@tanstack/react-router";
import { TaskList } from "@/components/task-list";

export const Route = createFileRoute("/_authenticated/all-tasks")({
  head: () => ({
    meta: [
      { title: "All Tasks — Smart Homes Task Manager" },
      { name: "description", content: "Every task you have access to." },
    ],
  }),
  component: () => <TaskList scope="all" title="All Tasks" />,
});
