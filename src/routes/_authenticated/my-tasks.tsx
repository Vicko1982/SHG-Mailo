import { createFileRoute } from "@tanstack/react-router";
import { TaskList } from "@/components/task-list";

export const Route = createFileRoute("/_authenticated/my-tasks")({
  head: () => ({
    meta: [
      { title: "My Tasks — Smart Homes Task Manager" },
      { name: "description", content: "Tasks assigned to me." },
    ],
  }),
  component: () => <TaskList scope="mine" title="My Tasks" />,
});
