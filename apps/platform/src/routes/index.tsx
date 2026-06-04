import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<div className="p-8">
			<h1 className="text-4xl font-bold">Welcome to TanStack Start</h1>
			<p className="mt-4 text-lg">
				Edit <code>src/routes/index.tsx</code> to get started.
			</p>

			<div className="mt-8 flex gap-4">
				<Button variant="default">Default Button</Button>
				<Button variant="outline">Outline Button</Button>
				<Button variant="secondary">Secondary Button</Button>
				<Button variant="destructive">Destructive Button</Button>

				<Dialog>
					<DialogTrigger asChild>
						<span className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-transparent bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80">
							Open Contact Form
						</span>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Contact Us</DialogTitle>
							<DialogDescription>
								Send us a message and we will get back to you.
							</DialogDescription>
						</DialogHeader>
						<form
							className="mt-4 flex flex-col gap-4"
							onSubmit={(e) => {
								e.preventDefault();
								// In a real app, you'd submit the form data here
							}}
						>
							<div className="flex flex-col gap-2">
								<Label htmlFor="name">Name</Label>
								<Input id="name" placeholder="Your name" />
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="email">Email</Label>
								<Input id="email" type="email" placeholder="your@email.com" />
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="message">Message</Label>
								<textarea
									id="message"
									className="flex min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
									placeholder="Your message..."
								/>
							</div>
							<div className="flex justify-end gap-2">
								<Button type="submit">Send</Button>
							</div>
						</form>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}
