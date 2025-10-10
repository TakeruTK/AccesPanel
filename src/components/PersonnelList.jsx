import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';

const PersonnelList = ({ personnel }) => {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>RUT</TableCell>
            <TableCell>Nombres</TableCell>
            <TableCell>Apellidos</TableCell>
            <TableCell>Teléfono</TableCell>
            <TableCell>Empresa</TableCell>
            <TableCell>Actividad</TableCell>
            <TableCell>Fecha de Inicio</TableCell>
            <TableCell>Fecha de Término</TableCell>
            <TableCell>Persona a Cargo</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {personnel.map((person, index) => (
            <TableRow key={index}>
              <TableCell>{person.rut}</TableCell>
              <TableCell>{person.nombres}</TableCell>
              <TableCell>{person.apellidos}</TableCell>
              <TableCell>{person.telefono}</TableCell>
              <TableCell>{person.empresa}</TableCell>
              <TableCell>{person.actividad}</TableCell>
              <TableCell>{person.fechaInicio}</TableCell>
              <TableCell>{person.fechaTermino}</TableCell>
              <TableCell>{person.personaACargo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default PersonnelList;
