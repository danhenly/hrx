import Link from "next/link";
import { FormSignIn } from "@/components/forms/auth/form-sign-in";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignInPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Enter your credentials to access your HR workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormSignIn />
      </CardContent>
      <CardFooter className="text-muted-foreground justify-center text-sm">
        Don&apos;t have an account?&nbsp;
        <Link
          href="/sign-up"
          className="text-foreground underline underline-offset-4"
        >
          Sign up
        </Link>
      </CardFooter>
    </Card>
  );
}
