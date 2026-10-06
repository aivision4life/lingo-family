import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  profileListSchema,
  profileSchema,
  verifyPinResponseSchema,
  type ProfileCreate,
  type ProfileUpdate,
} from "@shared/profile";
import { api } from "@/lib/api";

const PROFILES_KEY = ["profiles"] as const;

export function useProfiles() {
  return useQuery({
    queryKey: PROFILES_KEY,
    queryFn: () => api("GET", "/profiles", profileListSchema),
  });
}

/** Mutations refresh the cached profile list when they succeed. */
function useProfileMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

export const useCreateProfile = () =>
  useProfileMutation((input: ProfileCreate) => api("POST", "/profiles", profileSchema, input));

export const useUpdateProfile = () =>
  useProfileMutation(({ id, patch }: { id: string; patch: ProfileUpdate }) =>
    api("PATCH", `/profiles/${id}`, profileSchema, patch),
  );

export const useDeleteProfile = () =>
  useProfileMutation((id: string) => api("DELETE", `/profiles/${id}`, null));

export async function checkPin(id: string, pin: string): Promise<boolean> {
  const { ok } = await api("POST", `/profiles/${id}/verify-pin`, verifyPinResponseSchema, { pin });
  return ok;
}
