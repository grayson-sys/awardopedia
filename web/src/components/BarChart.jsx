"use client";

import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
import { formatCurrency } from "@/lib/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export default function BarChart({ labels, values, label = "Award Value" }) {
  const data = {
    labels,
    datasets: [{
      label,
      data: values,
      backgroundColor: "#1B3A6B",
      hoverBackgroundColor: "#D4940A",
      borderRadius: 4,
    }],
  };

  const options = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { ticks: { callback: (v) => formatCurrency(v) } },
      x: { ticks: { maxRotation: 45 } },
    },
  };

  return <Bar data={data} options={options} />;
}
