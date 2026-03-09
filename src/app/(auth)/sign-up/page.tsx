import Link from "next/link";
import { FormSignUp } from "@/components/forms/auth/form-sign-up";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Set up your organization and start managing your team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormSignUp />
      </CardContent>
      <CardFooter className="text-muted-foreground justify-center text-sm">
        Already have an account?&nbsp;
        <Link
          href="/sign-in"
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
