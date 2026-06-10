"use client"

import * as React from "react"
import {
  addDays,
  addMonths,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface DayRange {
  from?: Date
  to?: Date
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

/**
 * Lightweight single-month range calendar built on date-fns — no extra
 * dependency. Click a start day, then an end day; clicking again starts over.
 */
export function Calendar({
  value,
  onChange,
}: {
  value: DayRange
  onChange: (range: DayRange) => void
}) {
  const [month, setMonth] = React.useState(
    startOfMonth(value.from ?? value.to ?? new Date()),
  )

  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(addDays(gridStart, 34)) // always cover 6 weeks
  const days: Date[] = []
  for (let d = gridStart; !isAfter(d, gridEnd); d = addDays(d, 1)) {
    days.push(d)
  }

  const handleClick = (day: Date) => {
    if (!value.from || (value.from && value.to)) {
      onChange({ from: day, to: undefined })
    } else if (isBefore(day, value.from)) {
      onChange({ from: day, to: value.from })
    } else {
      onChange({ from: value.from, to: day })
    }
  }

  const inRange = (day: Date) =>
    value.from &&
    value.to &&
    isAfter(day, value.from) &&
    isBefore(day, value.to)

  const isEndpoint = (day: Date) =>
    (value.from && isSameDay(day, value.from)) ||
    (value.to && isSameDay(day, value.to))

  return (
    <div className="w-full select-none">
      <div className="mb-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{format(month, "MMMM yyyy")}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-xs font-medium text-muted-foreground">
            {w}
          </span>
        ))}
        {days.map((day) => {
          const endpoint = isEndpoint(day)
          const within = inRange(day)
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => handleClick(day)}
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors",
                !isSameMonth(day, month) && "text-muted-foreground/40",
                within && "bg-primary/10",
                endpoint
                  ? "bg-primary font-medium text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {format(day, "d")}
            </button>
          )
        })}
      </div>
    </div>
  )
}
