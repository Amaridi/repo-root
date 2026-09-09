import { Box, type BoxProps } from '@chakra-ui/react';

/**
 * Card de la charte : fond blanc, bordure 1px, radius 12px, SANS ombre.
 */
export function Card(props: BoxProps) {
  return (
    <Box
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      boxShadow="none"
      p="6"
      {...props}
    />
  );
}
