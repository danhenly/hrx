"use client";

import type { Row } from "@tanstack/react-table";
import { Lock, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PositionWithUsage } from "@/data/positions";

interface PositionsDataTableProps {
    data: PositionWithUsage[];
    isAdmin: boolean;
    onEdit: (position: PositionWithUsage) => void;
    onSetActive: (positionId: string, isActive: boolean) => void;
}

export function PositionsDataTable({
    data,
    isAdmin,
    onEdit,
    onSetActive,
}: PositionsDataTableProps) {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                            No positions yet — add the first one.
                        </TableCell>
                    </TableRow>
                )}
                {data.map((position) => (
                    <TableRow key={position._id}>
                        <TableCell>{position.name}</TableCell>
                        <TableCell>{position.department ?? "—"}</TableCell>
                        <TableCell>
                            <Badge variant={position.isActive ? "default" : "secondary"}>
                                {position.isActive ? "Active" : "Inactive"}
                            </Badge>
                        </TableCell>
                        <TableCell>{position.usageCount}</TableCell>
                        <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => onEdit(position)}
                                    aria-label="Edit position"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                {isAdmin && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span tabIndex={0}>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        disabled={position.usageCount > 0}
                                                        onClick={() =>
                                                            onSetActive(position._id, false)
                                                        }
                                                        aria-label="Delete position"
                                                    >
                                                        {position.usageCount > 0 ? (
                                                            <Lock className="h-3.5 w-3.5" />
                                                        ) : (
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        )}
                                                    </Button>
                                                </span>
                                            </TooltipTrigger>
                                            {position.usageCount > 0 && (
                                                <TooltipContent>
                                                    Used by {position.usageCount} position history
                                                    entries — deactivate instead.
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
