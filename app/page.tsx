"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { io, Socket } from "socket.io-client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// ---------------- Types ----------------
type Priority = "Low" | "Medium" | "High";
type Status = "Pending" | "In Progress" | "Completed";

interface IUser {
  _id: string;
  id?: string;
  username: string;
  email: string;
}

interface ITask {
  _id: string;
  id?: string;
  title: string;
  description: string;
  priority: Priority;
  status: Status;
  dueDate?: string;
  assignedTo?: IUser | null;
  createdBy: IUser;
  createdAt: string;
  updatedAt: string;
}

interface ILog {
  _id: string;
  id?: string;
  action: string;
  details?: string;
  performedBy?: { username: string; email: string };
  user?: { username: string; email: string };
  createdAt: string;
  taskId?: string;
  task?: string;
}

interface INotification {
  _id: string;
  id?: string;
  user: string;
  message: string;
  isRead: boolean;
  task?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------- Toast Component ----------------
const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-4 right-4 z-50 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg animate-in slide-in-from-top-2">
      <div className="flex items-center justify-between">
        <span className="text-sm">{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-white hover:text-gray-200"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

// ---------------- Axios ----------------
const api = axios.create({
  baseURL: "https://taskmanager-aqk1.onrender.com/api",
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ---------------- Component ----------------
export default function TaskManagerPage() {
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [isLoginMode, setIsLoginMode] = useState(true);

  // Auth forms
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", email: "", password: "" });

  // Data
  const [users, setUsers] = useState<IUser[]>([]);
  const [tasks, setTasks] = useState<ITask[]>([]);
  const [logsByTask, setLogsByTask] = useState<Record<string, ILog[]>>({});

  // Notifications & Toast
  const [notifications, setNotifications] = useState<INotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [scope, setScope] = useState<"all" | "created" | "assigned">("all");

  // Task modal
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editing, setEditing] = useState<ITask | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    priority: "Medium" as Priority,
    status: "Pending" as Status,
    dueDate: "",
    assignedTo: "" as string | "",
  });

  // Loading states
  const [loading, setLoading] = useState(false);

  // ---- Helper functions ----
  const showToast = (message: string) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const getTaskId = (task: ITask) => task._id || task.id || "";
  const getUserId = (user: IUser) => user._id || user.id || "";

  // ---- Load current user ----
  useEffect(() => {
    const userStr = localStorage.getItem("currentUser");
    if (userStr) {
      try {
        setCurrentUser(JSON.parse(userStr));
      } catch (e) {
        console.error("Failed to parse current user:", e);
        localStorage.removeItem("currentUser");
      }
    }
  }, []);

  // ---- Socket connect/register + live notifications ----
  useEffect(() => {
    if (!currentUser) return;

    // Connect socket if not already connected
    if (!socketRef.current) {
      socketRef.current = io("https://taskmanager-aqk1.onrender.com", {
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 1000,
      });
    }

    const socket = socketRef.current;

    socket.on("connect", () => {
      console.log("✅ Socket connected");
      // Register this userId on server
      socket.emit("register", getUserId(currentUser));
    });

    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected");
    });

    // Incoming real-time notifications
    const onNotification = (notif: INotification) => {
      console.log("🔔 New notification:", notif);
      setNotifications((prev) => [notif, ...prev]);
      showToast(notif.message);
         fetchTasks();
      
      // Browser notification if permission granted
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Task Manager", { 
            body: notif.message,
            icon: "/favicon.ico"
          });
        }

      } catch (e) {
        console.error("Browser notification error:", e);
      }
    };

    socket.on("notification", onNotification);

    return () => {
      socket.off("notification", onNotification);
      socket.off("connect");
      socket.off("disconnect");
    };
  }, [currentUser]);

  // Ask browser permission for native notifications
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ---- Fetch functions ----
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get<IUser[]>("/users");
      const userList = Array.isArray(res.data) ? res.data : res.data?.users || [];
      setUsers(userList);
    } catch (e: any) {
      console.error("Failed to fetch users:", e?.response?.data || e.message);
      showToast("Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      // Map scope to backend filter parameter
      if (scope === "created") params.set("filter", "created");
      else if (scope === "assigned") params.set("filter", "assigned");
      
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterPriority !== "all") params.set("priority", filterPriority);
      if (searchTerm) params.set("q", searchTerm);

      const res = await api.get<ITask[]>(`/tasks/my-tasks?${params.toString()}`);
      const taskList = Array.isArray(res.data) ? res.data : res.data?.tasks || [];
      setTasks(taskList);
    } catch (e: any) {
      console.error("Failed to fetch tasks:", e?.response?.data || e.message);
      showToast("Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    if (!currentUser) return;
    try {
      const res = await api.get<INotification[]>(`/notifications/${getUserId(currentUser)}`);
      const notifList = Array.isArray(res.data) ? res.data : res.data?.notifications || [];
      setNotifications(notifList);
    } catch (e: any) {
      console.error("Failed to fetch notifications:", e?.response?.data || e.message);
    }
  };

  const fetchLogs = async (taskId: string) => {
    try {
      const res = await api.get<ILog[]>(`/tasks/${taskId}/logs`);
      const logList = Array.isArray(res.data) ? res.data : res.data?.logs || [];
      setLogsByTask((p) => ({ ...p, [taskId]: logList }));
    } catch (e: any) {
      console.error("Failed to fetch logs:", e?.response?.data || e.message);
      showToast("Failed to fetch task logs");
    }
  };

  // Bootstrap after login
  useEffect(() => {
    if (currentUser) {
      fetchUsers();
      fetchTasks();
      fetchNotifications();
    }
  }, [currentUser, scope]);

  useEffect(() => {
    if (currentUser) fetchTasks();
  }, [filterStatus, filterPriority, searchTerm]);

  // -------- Auth handlers --------
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await api.post("/auth/register", registerForm);
      showToast("Registration successful! Please login.");
      setIsLoginMode(true);
      setRegisterForm({ username: "", email: "", password: "" });
    } catch (e: any) {
      const errorMsg = e?.response?.data?.message || "Registration failed";
      showToast(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const res = await api.post("/auth/login", loginForm);
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("currentUser", JSON.stringify(res.data.user));
      setCurrentUser(res.data.user);
      setLoginForm({ email: "", password: "" });

      // Register socket immediately if already connected
      if (socketRef.current?.connected) {
        socketRef.current.emit("register", res.data.user.id || res.data.user._id);
      }
      
      showToast(`Welcome back, ${res.data.user.username}!`);
    } catch (e: any) {
      const errorMsg = e?.response?.data?.message || "Login failed";
      showToast(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    setCurrentUser(null);
    setTasks([]);
    setNotifications([]);
    setLogsByTask({});
    try {
      socketRef.current?.disconnect();
      socketRef.current = null;
    } catch (e) {
      console.error("Socket disconnect error:", e);
    }
    showToast("Logged out successfully");
  };

  // -------- Task handlers --------
  const openCreate = () => {
    setEditing(null);
    setTaskForm({
      title: "",
      description: "",
      priority: "Medium",
      status: "Pending",
      dueDate: "",
      assignedTo: "",
    });
    setShowTaskForm(true);
  };

  const openEdit = (t: ITask) => {
    setEditing(t);
    setTaskForm({
      title: t.title,
      description: t.description || "",
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? t.dueDate.substring(0, 10) : "",
      assignedTo: t.assignedTo ? getUserId(t.assignedTo) : "",
    });
    setShowTaskForm(true);
  };

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      const payload: any = {
        title: taskForm.title,
        description: taskForm.description,
        priority: taskForm.priority,
        status: taskForm.status,
        dueDate: taskForm.dueDate || null,
        assignedTo: taskForm.assignedTo || null,
      };

      if (editing) {
        const res = await api.put(`/tasks/${getTaskId(editing)}`, payload);
        const updatedTask = res.data.task || res.data;
        setTasks((prev) => prev.map((x) => getTaskId(x) === getTaskId(editing) ? updatedTask : x));
        showToast("Task updated successfully!");
      } else {
        const res = await api.post("/tasks", payload);
        const newTask = res.data.task || res.data;
        setTasks((prev) => [newTask, ...prev]);
        showToast("Task created successfully!");
      }
      
      setShowTaskForm(false);
      setEditing(null);
    } catch (e: any) {
      const errorMsg = e?.response?.data?.message || "Failed to save task";
      showToast(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const deleteTask = async (task: ITask) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    
    try {
      setLoading(true);
      const taskId = getTaskId(task);
      await api.delete(`/tasks/${taskId}`);
      setTasks((prev) => prev.filter((x) => getTaskId(x) !== taskId));
      setLogsByTask((prev) => {
        const copy = { ...prev };
        delete copy[taskId];
        return copy;
      });
      showToast("Task deleted successfully!");
    } catch (e: any) {
      const errorMsg = e?.response?.data?.message || "Failed to delete task";
      showToast(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // -------- UI helpers --------
  const priorityDot = (p: Priority) =>
    p === "High" ? "bg-red-500" : p === "Medium" ? "bg-yellow-500" : "bg-green-500";

  const statusBadge = (s: Status) =>
    s === "Completed"
      ? "bg-green-100 text-green-800"
      : s === "In Progress"
      ? "bg-blue-100 text-blue-800"
      : "bg-gray-100 text-gray-800";

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  // Mark individual notification as read
  const markNotificationRead = async (notificationId: string) => {
    if (!currentUser) return;
    
    try {
      const response = await api.patch(`/notifications/${getUserId(currentUser)}/${notificationId}/read`);
      
      if (response.data.success) {
        setNotifications((prev) => 
          prev.map((n) => 
            (n._id || n.id) === notificationId ? { ...n, isRead: true } : n
          )
        );
      }
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const markAllReadLocal = async () => {
    if (!currentUser) return;
    
    try {
      // Only proceed if there are unread notifications
      const unreadNotifs = notifications.filter(n => !n.isRead);
      if (unreadNotifs.length === 0) {
        showToast("No unread notifications to mark");
        return;
      }

      // Call backend API to mark all as read
      const response = await api.patch(`/notifications/${getUserId(currentUser)}/mark-read`);
      
      if (response.data.success) {
        // Update only unread notifications to read in the UI
        setNotifications((prev) => 
          prev.map((n) => n.isRead ? n : { ...n, isRead: true })
        );
        showToast(`${response.data.modifiedCount} notifications marked as read`);
      }
    } catch (error) {
      console.error("Error marking notifications as read:", error);
      showToast("Failed to mark notifications as read");
    }
  };

  // ---- Auth gate ----
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            onClose={() => removeToast(toast.id)}
          />
        ))}
        
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">
              {isLoginMode ? "Login to Task Manager" : "Register for Task Manager"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={isLoginMode ? handleLogin : handleRegister} className="space-y-4">
              {!isLoginMode && (
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    placeholder="Enter your username"
                    value={registerForm.username}
                    onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={isLoginMode ? loginForm.email : registerForm.email}
                  onChange={(e) =>
                    isLoginMode
                      ? setLoginForm({ ...loginForm, email: e.target.value })
                      : setRegisterForm({ ...registerForm, email: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={isLoginMode ? loginForm.password : registerForm.password}
                  onChange={(e) =>
                    isLoginMode
                      ? setLoginForm({ ...loginForm, password: e.target.value })
                      : setRegisterForm({ ...registerForm, password: e.target.value })
                  }
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait..." : (isLoginMode ? "Login" : "Register")}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button 
                onClick={() => setIsLoginMode(!isLoginMode)} 
                className="text-blue-600 hover:underline"
                disabled={loading}
              >
                {isLoginMode ? "Need an account? Register" : "Have an account? Login"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Dashboard ----
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast notifications */}
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          onClose={() => removeToast(toast.id)}
        />
      ))}
      
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-gray-900">Task Manager</h1>

            <div className="flex items-center gap-4">
              {/* Notification Bell */}
              <div className="relative">
                <Button
                  variant="outline"
                  onClick={() => setShowNotifPanel((s) => !s)}
                  className="relative"
                  title="Notifications"
                >
                  🔔
                  {unreadCount > 0 && (
                    <span className="absolute -top-2 -right-2 text-xs px-1.5 py-0.5 rounded-full bg-red-600 text-white">
                      {unreadCount}
                    </span>
                  )}
                </Button>

                {showNotifPanel && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border rounded shadow-lg z-50">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                      <div className="font-semibold">Notifications</div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={fetchNotifications}>
                          Refresh
                        </Button>
                        <Button size="sm" variant="ghost" onClick={markAllReadLocal}>
                          Mark all read ({unreadCount})
                        </Button>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto p-2">
                      {notifications.length === 0 ? (
                        <div className="text-sm text-gray-500 p-2">No notifications</div>
                      ) : (
                        <ul className="space-y-2">
                          {notifications.map((n) => (
                            <li
                              key={n._id || n.id}
                              className={`p-2 rounded border cursor-pointer transition-colors ${
                                n.isRead ? "bg-white hover:bg-gray-50" : "bg-blue-50 hover:bg-blue-100"
                              }`}
                              onClick={() => !n.isRead && markNotificationRead(n._id || n.id || "")}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className={`text-sm ${!n.isRead ? "font-semibold" : ""}`}>
                                    {n.message}
                                  </div>
                                  <div className="text-[11px] text-gray-500 mt-1">
                                    {new Date(n.createdAt).toLocaleString()}
                                  </div>
                                </div>
                                {!n.isRead && (
                                  <div className="w-2 h-2 bg-blue-600 rounded-full ml-2 mt-1" />
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <span className="text-gray-700">Welcome, {currentUser.username}</span>
              <Button onClick={handleLogout} variant="outline">
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Controls */}
        <div className="mb-8 space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            <Button onClick={openCreate} disabled={loading}>
              Create New Task
            </Button>

            <Input
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs"
            />

            <Select value={scope} onValueChange={(v: any) => setScope(v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tasks</SelectItem>
                <SelectItem value="created">Created by Me</SelectItem>
                <SelectItem value="assigned">Assigned to Me</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPriority} onValueChange={(v) => setFilterPriority(v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Filter by priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Task Modal */}
        {showTaskForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
              <CardHeader>
                <CardTitle>{editing ? "Edit Task" : "Create New Task"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitTask} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="task-title">Task Title *</Label>
                    <Input
                      id="task-title"
                      placeholder="Enter task title"
                      value={taskForm.title}
                      onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="task-description">Description</Label>
                    <Textarea
                      id="task-description"
                      placeholder="Enter task description"
                      value={taskForm.description}
                      onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                      rows={3}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="task-priority">Priority</Label>
                    <Select
                      value={taskForm.priority}
                      onValueChange={(v: Priority) => setTaskForm({ ...taskForm, priority: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Low">🟢 Low</SelectItem>
                        <SelectItem value="Medium">🟡 Medium</SelectItem>
                        <SelectItem value="High">🔴 High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="task-status">Status</Label>
                    <Select
                      value={taskForm.status}
                      onValueChange={(v: Status) => setTaskForm({ ...taskForm, status: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">📝 Pending</SelectItem>
                        <SelectItem value="In Progress">⚡ In Progress</SelectItem>
                        <SelectItem value="Completed">✅ Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="task-due-date">Due Date</Label>
                    <Input
                      id="task-due-date"
                      type="date"
                      value={taskForm.dueDate}
                      onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="task-assign">Assign To</Label>
                    <Select
                      value={taskForm.assignedTo || "unassigned"}
                      onValueChange={(v) => setTaskForm({ ...taskForm, assignedTo: v === "unassigned" ? "" : v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select user to assign" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">👤 Unassigned</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={getUserId(u)} value={getUserId(u)}>
                            👨‍💻 {u.username} ({u.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button type="submit" disabled={loading}>
                      {loading ? "Saving..." : (editing ? "Update Task" : "Create Task")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowTaskForm(false);
                        setEditing(null);
                      }}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading...</p>
          </div>
        )}

        {/* Tasks Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <Card key={getTaskId(task)} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{task.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${priorityDot(task.priority)}`} title={`${task.priority} Priority`} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {task.description && (
                  <p className="text-gray-600 text-sm">
                    Description : {task.description}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Badge className={statusBadge(task.status)}>{task.status}</Badge>
                  <Badge variant="outline">{task.priority}</Badge>
                </div>
                {task.dueDate && (
                  <p className="text-sm text-gray-500">
                    📅 Due: {new Date(task.dueDate).toLocaleDateString()}
                  </p>
                )}
                {task.assignedTo && (
                  <p className="text-sm text-gray-500">
                    👤 Assigned to: {task.assignedTo.username}
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  👨‍💻 Created by: {task.createdBy?.username || "Unknown"}
                </p>
                <p className="text-xs text-gray-400">
                  📅 Created: {new Date(task.createdAt).toLocaleDateString()}
                </p>

                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(task)}>
                    ✏️ Edit
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteTask(task)}>
                    🗑️ Delete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => fetchLogs(getTaskId(task))}>
                    📋 Logs
                  </Button>
                </div>

                {/* Activity Logs */}
                {logsByTask[getTaskId(task)] && (
                  <div className="mt-3 bg-gray-50 p-3 rounded border max-h-40 overflow-y-auto">
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                      📋 Activity Logs
                    </h4>
                    <ul className="space-y-2 text-xs text-gray-600">
                      {logsByTask[getTaskId(task)].map((log) => (
                        <li key={log._id || log.id} className="border-l-2 border-blue-200 pl-2">
                          <div className="font-medium">
                            👨‍💻 {log.performedBy?.username || log.user?.username || "Unknown User"}
                          </div>
                          <div className="text-gray-700">
                            🔄 {log.action}
                          </div>
                          {log.details && (
                            <div className="text-gray-500 italic">
                              📝 {log.details}
                            </div>
                          )}
                          <div className="text-gray-400 mt-1">
                            ⏰ {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {tasks.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📝</div>
            <p className="text-gray-500 text-lg mb-4">No tasks found matching your criteria</p>
            <Button onClick={openCreate} size="lg">
              Create Your First Task
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}